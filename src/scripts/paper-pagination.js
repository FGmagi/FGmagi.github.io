/**
 * 文章纸质分页（frontmatter: display_mode = single | double）
 *
 * 规则（与需求逐条对应）：
 *   1) 版面默认 A4（宽 : 高 = 1 : 1.4142），页与页之间插入分隔线；
 *   2) 每一章另起一页：章 = 文章内**最高一级**标题（文章里最高级可能是 h2/h3，只按那一级切）；
 *      ⚠ 正文被 remark-sectionize 包成 <section> 时必须先拆开：否则整章是「一个不可拆的块」，
 *        分页脚本无法把它拆到多页，长章会横向长出第 3、4 栏、被 overflow 裁掉（实测丢过内容）；
 *   3) 页高自适应：先按固定版面高填页（决定分页位置），再把每页收紧到内容真正用掉的高度；
 *      一栏塞满、另一栏空一半时，该页改走「两栏均衡 + 高度随内容」，因此不会出现大片空白；
 *   4) 章节最后一页：内容不足半页 → 并入该章倒数第二页；只有一页 / 超过半页 → 单独渲染，
 *      该页不补 A4 空白，并在内容结束处渲染分隔线（下一章紧随其后）；
 *   5) 章标题落在章节首页顶部，按 title_position（left/middle/right）对齐；
 *   6) single 单栏分页、double 双栏分页；窄屏（<768px）双栏降为单栏，量测同步按单栏算；
 *   7) 正文里可用指令临时切换模式：`<!-- model:single -->` / `<!-- model:double -->` /
 *      `<!-- model:default -->`，只影响其后的内容；
 *   8) 双栏下给元素加 `data-span="full"` 可临时跨栏（整宽大图）；
 *      多图横排：外层 `<div data-img-row>`，每张 `<img data-w="40">`（40 = 占页宽百分比），
 *      超出部分用横向滚动条查看。
 *   9) 对齐：frontmatter 的 text_position（left / middle / right，默认 left）决定正文、
 *      图片、音频靠左/居中/靠右；正文里可用 `<!-- text_position:middle -->` 指令，
 *      从该处往后切换（分页模式下按页生效）。节点自带的行内 style 优先级更高。
 *   ⚠ 封面/卡片本身的渲染完全不动：只重排 .markdown-content 里的正文节点。
 */

const PAGE_RATIO = 1.4142; // A4 高 / 宽
/** 页高下限：0.33 × A4 高（视口很矮时也至少给这么高，保证一页有足够内容） */
const MIN_PAGE_RATIO = 0.33;
const MIN_PAGE_WIDTH = 280;
const TAIL_RATIO = 0.5; // 末页内容 ≤ 半页 ⇒ 并入上一页
/** 安全阀：逐块量高度是强制重排，节点太多的超长文强行分页会卡死浏览器。
 *  超过上限时放弃分页、保持原流式排版，并在控制台提示（封面/正文照常可读）。 */
const MAX_BLOCKS = 600;
const MAX_PAGES = 80;
const DIRECTIVE_RE =
	/^\s*(?:model|paper|display)\s*[:=]?\s*(default|single|double)\s*$/i;
/** 正文里的对齐指令：`<!-- text_position:middle -->`（也接受 align / text-align / center 写法） */
const TEXT_POSITION_RE =
	/^\s*(?:text[_-]?\s*position|align|text-align)\s*[:=]?\s*(left|middle|center|right)\s*$/i;
const TEXT_POSITIONS = ["left", "middle", "right"];

/** 容器 → 原始子节点数组（还原/重新分页时用） */
const ORIGINALS = new WeakMap();
let reflowTimer = 0;
let running = false;

const isDirectiveNode = (node) =>
	node.nodeType === 8 && DIRECTIVE_RE.test(node.nodeValue || "");

/** 归一化对齐取值：center 归到 middle，未知/空值回落 left */
function normalizeTextPosition(value) {
	const v = String(value == null ? "" : value).trim().toLowerCase();
	if (v === "center") return "middle";
	return TEXT_POSITIONS.indexOf(v) >= 0 ? v : "left";
}

const isTextPositionDirective = (node) =>
	node.nodeType === 8 && TEXT_POSITION_RE.test(node.nodeValue || "");

const headingLevel = (node) => {
	if (!node || node.nodeType !== 1) return 0;
	const m = /^H([1-6])$/.exec(node.tagName || "");
	return m ? Number(m[1]) : 0;
};

/**
 * 取正文的「分页单位」节点列表。
 * remark-sectionize 会把每个标题下的内容包成 <section>，整章就成了一个不可拆的大块：
 * 分页脚本只能在页与页之间搬块，没法把一整章拆到多页 ⇒ 长章横向长出第 3、4 栏被裁掉。
 * 所以这里把 <section> 拆开，让分页按 h2 / 段落 / 图片这些真正的块级单位工作
 * （标题节点本身保留，id 与锚点不受影响）。
 */
function collectBlocks(container) {
	const blocks = [];
	Array.from(container.childNodes).forEach((node) => {
		// 纯空白文本节点（markdown 在块之间输出的换行）没有任何版面意义，
		// 留在数组里会凭空多出一个「空章」，多渲染一张空页
		if (node.nodeType === 3 && !(node.nodeValue || "").trim()) return;
		if (node.nodeType === 1 && node.tagName === "SECTION") {
			Array.from(node.childNodes).forEach((child) => blocks.push(child));
		} else {
			blocks.push(node);
		}
	});
	return blocks;
}

/**
 * 图片提前占位：按原始像素比写死 aspect-ratio。
 * ⚠ 正文里的 <img> 没有 width/height 属性，未加载完时高度是 0，量出来的版面是错的
 *   （会导致分页位置离谱、页尾留大片空白）。所以这里补上比例并让它们尽快加载。
 */
function primeImages(root) {
	root.querySelectorAll("img").forEach((img) => {
		const apply = () => {
			if (img.naturalWidth > 0 && img.naturalHeight > 0) {
				img.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
			}
		};
		apply();
		if (img.loading !== "eager") img.loading = "eager";
		if (!img.complete) {
			img.addEventListener(
				"load",
				() => {
					apply();
					schedule(80);
				},
				{ once: true },
			);
		}
	});
}

/** 正文容器所在上下文（文章卡上的两个 data-* 决定初始模式与标题对齐） */
function getContext() {
	const card = document.querySelector("#post-container[data-display-model]");
	if (!card) return null;
	const container = card.querySelector(".markdown-content");
	if (!container) return null;
	return {
		card,
		container,
		model: (
			card.getAttribute("data-display-model") || "default"
		).toLowerCase(),
		titlePosition: (
			card.getAttribute("data-title-position") || "left"
		).toLowerCase(),
		textPosition: normalizeTextPosition(card.getAttribute("data-text-position")),
	};
}

/** 还原为原始顺序（切回 default、或重新分页前先还原） */
function restore(container) {
	const originals = ORIGINALS.get(container);
	if (!originals) return;
	container.textContent = ""; // 丢弃页壳，原始节点引用仍在 originals 里
	originals.forEach((node) => container.appendChild(node));
}

/**
 * 按「指令 / 最高一级标题」把正文切成若干片段，
 * 每个片段带自己生效的分页模式（model）与对齐方式（textPosition）。
 */
function splitParts(container, initialModel, initialTextPosition) {
	const originals = ORIGINALS.get(container);
	let minLevel = 7;
	originals.forEach((node) => {
		const lv = headingLevel(node);
		if (lv && lv < minLevel) minLevel = lv;
	});

	const parts = [];
	let model = initialModel;
	let textPosition = normalizeTextPosition(initialTextPosition);
	let current = { model, textPosition, title: null, nodes: [] };
	parts.push(current);

	originals.forEach((node) => {
		if (node.nodeType === 8) {
			const m = DIRECTIVE_RE.exec(node.nodeValue || "");
			if (m) {
				// 指令本身不渲染：切换模式并从该处开一个新模式片段
				model = m[1].toLowerCase();
				current = { model, textPosition, title: null, nodes: [] };
				parts.push(current);
				return;
			}
			const t = TEXT_POSITION_RE.exec(node.nodeValue || "");
			if (t) {
				// 对齐指令：只切换对齐，分页模式不变，指令之后的内容生效
				textPosition = normalizeTextPosition(t[1]);
				current = { model, textPosition, title: null, nodes: [] };
				parts.push(current);
			}
			return;
		}
		const lv = headingLevel(node);
		if (lv && lv === minLevel) {
			if (current.nodes.length) {
				// 最高一级标题 ⇒ 另起一章（标题自身留作该章首节点，落在首页顶部）
				current = { model, textPosition, title: node, nodes: [] };
				parts.push(current);
			} else {
				// 正文就以标题开头（清掉块间空白后很常见）：把它当成本章的标题
				current.title = node;
			}
		}
		current.nodes.push(node);
	});

	return { parts, minLevel };
}

/* --------------------------- 量测与分页 --------------------------- */

/** 这些标签自己就是一块，量几何时直接用（不必再往下钻） */
const ATOMIC_TAGS = new Set([
	"IMG",
	"AUDIO",
	"VIDEO",
	"IFRAME",
	"HR",
	"TABLE",
	"PRE",
	"SVG",
]);

/** 页里实际生效的栏数：窄屏 CSS 会把双栏降成单栏，量测必须跟着变 */
function effectiveCols(body) {
	const cols = Number(window.getComputedStyle(body).columnCount);
	return Number.isFinite(cols) && cols > 0 ? cols : 1;
}

/**
 * 某页是否放不下：
 *   多栏容器（含窄屏降成的「单栏多栏容器」）⇒ 看有没有「长出下一栏」：
 *     CSS 多栏在放不下时永远是**横向**长出第 2、3 栏，不会纵向增高，
 *     所以这里必须看 scrollWidth（窄屏 column-count:1 时同样如此，看页高是看不出来的）；
 *   普通单栏块（single 模式）⇒ 看有没有超过页高。
 * ⚠ 用滚动尺寸判断比逐块量高度可靠：段落会被浏览器拆到两栏里，
 *   逐块量只看得到块的首尾，看不出被拆栏的长段落已经溢出，内容会被静默裁掉。
 */
function pageOverflows(page) {
	const { body } = page;
	if (window.getComputedStyle(body).columnCount !== "auto") {
		return body.scrollWidth > Math.ceil(body.clientWidth) + 1;
	}
	return body.scrollHeight > Math.ceil(body.clientHeight) + 1;
}

/** 每栏的填充下沿（px）：按文本片段 / 图片逐块量，得到这一页真正用掉了多少 */
function columnFills(body, cols) {
	const rect = body.getBoundingClientRect();
	const gap =
		Number(
			String(window.getComputedStyle(body).columnGap).replace(/[^0-9.]/g, ""),
		) || 0;
	const step = (rect.width - gap * (cols - 1)) / cols + gap;
	const fills = new Array(cols).fill(0);
	const push = (r) => {
		if (!r || (r.width <= 0 && r.height <= 0)) return;
		const i = Math.max(
			0,
			Math.min(cols - 1, Math.round((r.left - rect.left) / step)),
		);
		fills[i] = Math.max(fills[i], r.bottom - rect.top);
	};
	const walk = (node) => {
		if (node.nodeType === 3) {
			if (!node.nodeValue || !node.nodeValue.trim()) return;
			const range = document.createRange();
			range.selectNodeContents(node);
			Array.from(range.getClientRects()).forEach(push);
			return;
		}
		if (node.nodeType !== 1) return;
		if (ATOMIC_TAGS.has(node.tagName)) {
			Array.from(node.getClientRects()).forEach(push);
			return;
		}
		Array.from(node.childNodes).forEach(walk);
	};
	Array.from(body.childNodes).forEach(walk);
	return fills;
}

/** 一页的版面占用比例（0~1）：两栏取平均填充度 */
function usedRatio(page, cols) {
	const height = Math.max(1, page.body.getBoundingClientRect().height);
	const fills = columnFills(page.body, cols);
	const used = fills.reduce((sum, v) => sum + Math.min(v, height), 0);
	return used / (height * cols);
}

/**
 * 一页能装多少：取视口高与 A4 高中的小者（电脑上按窗口高度排版、窗口很矮时也不会切得太碎），
 * 且不低于 0.33 × A4 高。
 */
function pageBudget(width) {
	const a4Height = Math.max(200, Math.round(width * PAGE_RATIO));
	return Math.max(
		Math.round(a4Height * MIN_PAGE_RATIO),
		Math.min(a4Height, Math.round(window.innerHeight)),
	);
}

/**
 * 自适应页高：一页没填满时（整块大图/图组被挤到下一栏，页尾就会留一大片空白），
 * 把这一页改成「两栏均衡 + 高度随内容」——两栏铺平、页高收到内容实际高度，空白随之消失。
 * 填满的页保持固定 A4 版面高（纸质感）；改成均衡后若装不下（会长出第 3 栏）则回退。
 */
function adaptPageHeight(page, pageHeight, cols) {
	if (page.page.classList.contains("paper-page--auto")) return;
	const fills = columnFills(page.body, cols);
	const total = fills.reduce((sum, v) => sum + Math.min(v, pageHeight), 0);
	if (total >= pageHeight * cols * 0.96) return; // 基本填满：保留 A4 版面
	page.page.classList.add("paper-page--auto");
	if (pageOverflows(page)) page.page.classList.remove("paper-page--auto"); // 装不下 ⇒ 回退
}

function paginatePart(part, width, pagesRoot) {
	const isDouble = part.model === "double";
	const pageHeight = pageBudget(width);
	const textPosition = normalizeTextPosition(part.textPosition);
	const pages = [];

	const newPage = () => {
		const page = document.createElement("div");
		page.className = `paper-page paper-page--${isDouble ? "double" : "single"}`;
		page.style.height = `${pageHeight}px`;
		page.style.setProperty("--paper-col-h", `${pageHeight}px`); // 单张大图的高度上限
		const body = document.createElement("div");
		body.className = "paper-page__body";
		body.setAttribute("data-text-position", textPosition); // 这一页正文/图片/音频的对齐
		page.appendChild(body);
		pagesRoot.appendChild(page);
		const record = { page, body, closed: false };
		pages.push(record);
		return record;
	};

	let current = newPage();
	part.nodes.forEach((node) => {
		if (node.nodeType === 3 && !node.nodeValue.trim()) return; // 纯空白不占版面
		if (current.closed) current = newPage(); // 上一页是「单块超高」页 ⇒ 后面内容另起一页
		const alone = current.body.childNodes.length === 0;
		current.body.appendChild(node);
		if (!pageOverflows(current)) return;
		// 第一块自己就超过一页：整页随内容高度（图片已被 --paper-col-h 限在一栏内）
		if (alone) {
			current.page.classList.add("paper-page--auto");
			current.closed = true;
			return;
		}
		// 这块超出了本页版面 ⇒ 移到新页
		current.body.removeChild(node);
		current = newPage();
		current.body.appendChild(node);
		if (pageOverflows(current)) {
			current.page.classList.add("paper-page--auto");
			current.closed = true;
		}
	});

	// 章节末页：内容 ≤ 半页 ⇒ 并入倒数第二页；否则该页不补白（内容结束处就是分页处）
	if (pages.length > 1) {
		const last = pages[pages.length - 1];
		const prev = pages[pages.length - 2];
		if (!prev.closed && usedRatio(last, effectiveCols(last.body)) <= TAIL_RATIO) {
			const moved = Array.from(last.body.childNodes);
			moved.forEach((node) => prev.body.appendChild(node));
			prev.page.classList.add("paper-page--auto");
			// 双栏并入后若溢到第 3 栏（会被裁切）⇒ 撤销合并，改回「末页单独渲染」
			if (pageOverflows(prev)) {
				moved.forEach((node) => last.body.appendChild(node));
				prev.page.classList.remove("paper-page--auto");
				last.page.classList.add("paper-page--auto");
			} else {
				last.page.remove();
				pages.pop();
			}
		} else {
			last.page.classList.add("paper-page--auto");
		}
	} else {
		// 章节只有一页：内容渲染完立即分页（高度随内容，不留 A4 空白）
		if (pages[0].body.childNodes.length) {
			pages[0].page.classList.add("paper-page--auto");
		}
	}

	// 自适应页高：没填满的页改成两栏均衡 + 高度随内容，页尾不留大片空白
	pages.forEach((page) => adaptPageHeight(page, pageHeight, effectiveCols(page.body)));

	return pages;
}

/** 图片便捷写法：data-w 百分比宽；data-img-row 外层做横向滚动行 */
function applyImageOptions(root) {
	root.querySelectorAll("img[data-w]").forEach((img) => {
		const w = String(img.getAttribute("data-w") || "").replace(
			/[^\d.]/g,
			"",
		);
		if (w && Number(w) > 0) img.style.setProperty("--paper-img-w", `${w}%`);
	});
	root.querySelectorAll("[data-img-row]").forEach((row) => {
		Array.from(row.children).forEach((child) => {
			const img =
				child.tagName === "IMG"
					? child
					: child.querySelector("img[data-w]");
			if (!img) return;
			const w = String(img.getAttribute("data-w") || "").replace(
				/[^\d.]/g,
				"",
			);
			if (w && Number(w) > 0) child.style.width = `${w}%`;
		});
	});
}

/* --------------------------- 主流程 --------------------------- */

function run() {
	const ctx = getContext();
	if (!ctx) return;
	const { card, container, model, titlePosition, textPosition } = ctx;

	// 正文容器的对齐基准：frontmatter 的 text_position（指令会在此基础上按段覆盖）
	container.setAttribute("data-text-position", textPosition);

	if (!ORIGINALS.has(container)) {
		// 首次：记下原始顺序（<section> 拆开，分页才有「块」可搬）；正文里若没有指令，节点始终就是这一批
		ORIGINALS.set(container, collectBlocks(container));
	} else {
		restore(container);
	}

	const originals = ORIGINALS.get(container);
	const hasDirective = originals.some(isDirectiveNode);
	card.classList.remove("paper-paginated");
	if (model === "default" && !hasDirective) {
		// 不分页：正文里可能只用 <!-- text_position:xxx --> 切对齐（不影响分页）
		applyTextPositionOnly(container, originals, textPosition);
		return;
	}

	const width = Math.max(
		MIN_PAGE_WIDTH,
		Math.round(container.getBoundingClientRect().width),
	);

	// 量版面之前先把图片尺寸定下来（aspect-ratio + 尽快加载），否则未加载的图高度为 0
	primeImages(container);

	const { parts } = splitParts(container, model, textPosition);
	const pagesRoot = document.createElement("div");
	pagesRoot.className = "paper-pages";

	// 安全阀：块太多（超长文）时放弃分页，保持原样并在控制台提示，避免把浏览器卡死
	const blockCount = parts.reduce((sum, part) => sum + part.nodes.length, 0);
	if (blockCount > MAX_BLOCKS) {
		console.warn(
			`[paper] 正文块数 ${blockCount} 超过上限 ${MAX_BLOCKS}，已跳过自动分页（保持原排版）`,
		);
		return;
	}

	// 先清空容器（节点都还在 parts 里，引用未失效）
	container.textContent = "";
	container.appendChild(pagesRoot);
	card.classList.add("paper-paginated");

	try {
		buildPages(container, parts, width, titlePosition, textPosition, pagesRoot);
	} catch (err) {
		// ⚠ 兜底红线：分页过程中任何异常，都必须把正文按原顺序放回去，
		//   否则页面会变成「什么都不显示」（实测踩过：文本节点量几何抛错把正文清空）。
		console.warn("[paper] 分页失败，已回退为原排版：", err);
		card.classList.remove("paper-paginated");
		restore(container);
	}
}

/**
 * 把「保持流式」的片段挂回去：与基准对齐相同时不套壳
 * （避免多一层 div 影响正文样式选择器）；不同时补一层带 data-text-position 的容器。
 */
function appendFlowPart(root, part, baseTextPosition) {
	const position = normalizeTextPosition(part.textPosition);
	if (position === baseTextPosition) {
		part.nodes.forEach((node) => root.appendChild(node));
		return;
	}
	const wrap = document.createElement("div");
	wrap.className = "paper-flow-part";
	wrap.setAttribute("data-text-position", position);
	part.nodes.forEach((node) => wrap.appendChild(node));
	root.appendChild(wrap);
}

/**
 * 不分页时（display_mode: default）也要支持 text_position 指令：
 * 有指令才按指令切段套容器；没有指令就完全不动 DOM（保持原来的流式排版）。
 */
function applyTextPositionOnly(container, originals, baseTextPosition) {
	if (!originals.some(isTextPositionDirective)) return;
	container.textContent = "";
	const { parts } = splitParts(container, "default", baseTextPosition);
	parts.forEach((part) => {
		if (!part.nodes.length) return;
		appendFlowPart(container, part, baseTextPosition);
	});
}

/** 真正建页：按片段分页 + 补分隔线 + 图片选项（异常由 run() 兜底回退） */
function buildPages(container, parts, width, titlePosition, textPosition, pagesRoot) {
	const allPages = [];
	parts.forEach((part) => {
		if (!part.nodes.length) return;
		if (part.title) {
			part.title.classList.add(
				"paper-chapter-title",
				`paper-title--${titlePosition}`,
			);
		}
		if (part.model === "default") {
			// 指令前的 default 片段：保持流式（对齐与基准不同时才补容器）
			appendFlowPart(pagesRoot, part, textPosition);
			return;
		}
		allPages.push(...paginatePart(part, width, pagesRoot));
		if (allPages.length > MAX_PAGES) {
			console.warn(
				`[paper] 页数超过上限 ${MAX_PAGES}，已停止分页（保持已生成的部分）`,
			);
			return;
		}
	});

	// 页与页之间补分隔线（含章节之间）
	const pageEls = Array.from(pagesRoot.querySelectorAll(".paper-page"));
	pageEls.forEach((page, i) => {
		if (i === pageEls.length - 1) return;
		const hr = document.createElement("hr");
		hr.className = "paper-divider";
		page.after(hr);
	});

	applyImageOptions(container);

	// 内容被搬进新容器后，重新广播一次「页面视图」让灯箱/脚注等重新绑定。
	// ⚠ 必须打上 fromPaper 标记：本模块自己也监听 swup:page:view，
	//   不标记就会「分页 → 派发 → 再次分页」递归（实测会卡死）。
	document.dispatchEvent(
		new CustomEvent("swup:page:view", { detail: { fromPaper: true } }),
	);
}

function schedule(delay = 80) {
	window.clearTimeout(reflowTimer);
	reflowTimer = window.setTimeout(() => {
		if (running) return;
		run();
	}, delay);
}

function bind() {
	if (window.__paperPaginationBound) return;
	window.__paperPaginationBound = true;
	window.addEventListener("resize", () => schedule(200), { passive: true });
	document.addEventListener("swup:page:view", (event) => {
		if (event.detail && event.detail.fromPaper) return; // 自己派发的，忽略
		schedule(120);
	});
	document.addEventListener("swup:content:replace", () => schedule(120));
	window.addEventListener("load", () => schedule(200));
	if (document.fonts?.ready) {
		document.fonts.ready.then(() => schedule(120)).catch(() => {});
	}
	schedule(200);
}

bind();

// 本文件由页面里的 `import('...paper-pagination.js')` 动态加载，运行时本来就是 ES 模块；
// 显式导出一个空对象让 TS 也按模块解析（否则它被当成全局脚本：astro check 会报
// ts(2306)「is not a module」，文件里的顶层变量还会与别的全局脚本重名冲突）。
export {};
