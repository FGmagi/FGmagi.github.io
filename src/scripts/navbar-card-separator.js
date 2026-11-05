
// ⚠ 必须用 #navbar 自身：它的第一个子 div 是「用于入场动画」的 absolute 辅助层
//   （top:-2rem/h:2rem），量它会得到 bottom=0，描边永远不会出现。
//   #navbar 的盒子与可见的导航栏卡片一致，也与 toc-layout.js 的底边口径同源。
const NAV_CARD_SELECTOR = "#navbar";
const SEPARATOR_ID = "navbar-card-separator";
const SAMPLE_COUNT = 12; // 采样点数：够覆盖多个并排卡片，又不至于太重
const EDGE_INSET = 4; // 两端各留 4px：导航栏是圆角卡片，线贴到端头会戳出圆角
const MIN_RUN_PX = 24; // 少于这个宽度的区间忽略（避免边缘抖动导致线一闪一闪）
/** 线条中心颜色（与 MainGridLayout 里 #navbar-card-separator 的 CSS 同源：主题色 55% 透明） */
const LINE_COLOR = "color-mix(in oklab, var(--primary) 55%, transparent)";
/** 距卡片左右边各多少比例处透明度降为 0（用户要求：左右各 5%） */
const EDGE_FADE_RATIO = 0.05;

let separator = null;
let rafId = 0;
let lastKey = "";
/** 缓存：卡片在文档坐标系里的位置 + 线的横向区间（null = 当前没有可画的卡片） */
let geometry = null;

function ensureSeparator() {
	if (separator && separator.isConnected) return separator;
	separator = document.createElement("div");
	separator.id = SEPARATOR_ID;
	separator.setAttribute("aria-hidden", "true");
	document.body.appendChild(separator);
	return separator;
}

function hide(el) {
	if (el.classList.contains("is-visible")) el.classList.remove("is-visible");
}

/**
 * 找「主卡片」：在竖直方向跨过导航栏底边、且有可见背景的元素里，取最宽的那个。
 *
 * ⚠ 为什么取最宽而不是「第一个有背景的祖先」：命中点下面是普通人无法预测的内容——
 *   代码块、引用块、license 块、图片、左右磁贴……它们各自都有背景，取第一个会让线长
 *   随滚动内容不断变化、甚至短到被丢弃。卡片是这些内部块的共同祖先，取「最宽且不超过
 *   导航栏宽度」的那个，长度才稳定，也对应需求里的「主卡片」。
 *
 * 只在 refreshGeometry() 里调用（不在滚动帧里）。
 */
function findMainCard(nav, navBottom, innerLeft, innerRight) {
	const sampleY = navBottom + 1;
	const maxWidth = nav.width * 1.02; // 超过导航栏宽度的（整页容器/浮层）不算卡片
	let best = null;
	let bestWidth = 0;

	for (let i = 0; i < SAMPLE_COUNT; i++) {
		const x = innerLeft + ((innerRight - innerLeft) * (i + 0.5)) / SAMPLE_COUNT;
		const hit = document.elementFromPoint(x, sampleY);
		let cur = hit;
		while (cur && cur !== document.body && cur.nodeType === 1) {
			const cs = window.getComputedStyle(cur);
			// 「卡片」判据：有可见背景 + 有圆角（卡片都是圆角块；#main-grid / 各层容器是没有圆角的，
			// 不排除它们就会把线画到比卡片宽 16px 的位置）
			const rounded = parseFloat(cs.borderTopLeftRadius) > 0;
			if (cs.display !== "inline" && cs.backgroundColor !== "transparent" && rounded) {
				const rect = cur.getBoundingClientRect();
				// 必须竖直方向跨过导航栏底边，且宽于当前最优
				if (
					rect.width > bestWidth &&
					rect.width <= maxWidth &&
					rect.top <= navBottom &&
					rect.bottom >= navBottom &&
					rect.width > 0
				) {
					bestWidth = rect.width;
					best = { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
				}
			}
			cur = cur.parentElement;
		}
	}
	return best;
}

/**
 * 线的透明度分布（用户要求）：中心 = 主题色 55%，向左右两侧线性降低，
 * 在**距卡片左右边各 5%** 的位置降到 0 ⇒ 视觉上是一条中间实、两端渐隐的横线。
 */
function lineGradient(width) {
	const w = Math.max(2, width);
	const fade = Math.max(1, Math.round(w * EDGE_FADE_RATIO));
	const center = Math.round(w / 2);
	return `linear-gradient(to right, transparent ${fade}px, ${LINE_COLOR} ${center}px, transparent ${w - fade}px)`;
}

function currentScrollY() {
	return window.scrollY || window.pageYOffset || 0;
}

/**
 * 重算缓存（事件驱动，不是每帧）：把所有布局读取集中在这里。
 */
function refreshGeometry() {
	// 切页渐变期间（淡出 / 渐显中）#main-grid 是 pointer-events:none，
	// elementFromPoint 采不到卡片。此时**保持旧缓存不动**，等重试/后续事件再量，
	// 否则每来一次事件就把缓存清空、重试循环又从头跑，白烧几十次样式计算。
	if (
		document.body.classList.contains("page-entering") ||
		document.body.classList.contains("swup-leaving")
	) {
		schedulePaint();
		return;
	}

	const navCard = document.querySelector(NAV_CARD_SELECTOR);
	if (!navCard) {
		geometry = null;
		schedulePaint();
		return;
	}

	const nav = navCard.getBoundingClientRect();
	const navBottom = Math.round(nav.bottom);
	const innerLeft = nav.left + EDGE_INSET;
	const innerRight = nav.right - EDGE_INSET;

	if (
		nav.width <= 0 ||
		navBottom <= 0 ||
		navBottom >= window.innerHeight - 1 ||
		innerRight - innerLeft < MIN_RUN_PX
	) {
		geometry = null;
		schedulePaint();
		return;
	}

	const card = findMainCard(nav, navBottom, innerLeft, innerRight);
	if (!card) {
		geometry = null;
		schedulePaint();
		return;
	}

	const left = Math.round(Math.max(card.left, innerLeft));
	const right = Math.round(Math.min(card.right, innerRight));
	const width = right - left;
	if (width < MIN_RUN_PX) {
		geometry = null;
		schedulePaint();
		return;
	}

	// 换算成文档坐标：之后每帧只做减法即可判断遮挡，不再触碰布局
	const scrollY = currentScrollY();
	// 导航栏通常挂在 #top-row 上并被 CSS 固定为 fixed（吸顶），此时底边恒定，
	// 可完全免掉每帧的 getBoundingClientRect；#top-row 回到 static（navbar.pinned=false）
	// 时才需要每帧读一次。
	const anchor = navCard.closest("#top-row") || navCard;
	const anchorPosition = window.getComputedStyle(anchor).position;
	geometry = {
		left,
		width,
		navBottom,
		fixed: anchorPosition === "fixed" || anchorPosition === "sticky",
		topDoc: card.top + scrollY,
		bottomDoc: card.bottom + scrollY,
	};
	// 采到就停掉首载重试
	if (retryTimer) {
		window.clearTimeout(retryTimer);
		retryTimer = 0;
	}
	schedulePaint();
}

/**
 * 每帧的写入端：只读 scrollY（吸顶导航栏连底边都不用再量），
 * 其余全是算术 —— 不做元素命中测试、不读 computedStyle。
 */
function paint() {
	rafId = 0;
	const el = ensureSeparator();
	if (!el) return;

	if (!geometry) {
		hide(el);
		return;
	}

	const navCard = document.querySelector(NAV_CARD_SELECTOR);
	if (!navCard) {
		hide(el);
		return;
	}

	// fixed/sticky 时用缓存值（零布局读取）；随页滚动的导航栏才每帧量一次
	const navBottom = geometry.fixed
		? geometry.navBottom
		: Math.round(navCard.getBoundingClientRect().bottom);
	if (navBottom <= 0 || navBottom >= window.innerHeight - 1) {
		hide(el);
		return;
	}

	const scrollY = currentScrollY();
	const cardTop = geometry.topDoc - scrollY;
	const cardBottom = geometry.bottomDoc - scrollY;
	// 卡片必须仍横跨导航栏底边才画线（纯算术）
	if (navBottom < cardTop || navBottom > cardBottom) {
		hide(el);
		return;
	}

	const key = `${geometry.left}|${geometry.width}|${navBottom}`;
	if (key !== lastKey) {
		lastKey = key;
		el.style.left = `${geometry.left}px`;
		el.style.width = `${geometry.width}px`;
		el.style.top = `${navBottom}px`;
		el.style.background = lineGradient(geometry.width);
	}
	if (!el.classList.contains("is-visible")) el.classList.add("is-visible");
}

function schedulePaint() {
	if (rafId) return;
	rafId = window.requestAnimationFrame(paint);
}

let retryTimer = 0;
let retryCount = 0;
function retryUntilReady() {
	if (geometry || retryCount >= 8) return;
	retryCount += 1;
	retryTimer = window.setTimeout(() => {
		retryTimer = 0;
		refreshGeometry();
		retryUntilReady();
	}, 250);
}

/**
 * 换页 / 首次加载后补量几拍：图片陆续加载会改变卡片高度，
 * 只量一次可能记下的是「还没长高」的几何，导致描边区间偏小。
 */
function refreshSoon() {
	refreshGeometry();
	window.setTimeout(refreshGeometry, 400);
	window.setTimeout(refreshGeometry, 1200);
}

function bind() {
	if (window.__navbarCardSeparatorBound) return;
	window.__navbarCardSeparatorBound = true;
	ensureSeparator();

	// 滚动：只重绘（paint 内无布局读取）
	window.addEventListener("scroll", schedulePaint, { passive: true });

	// 几何变化：这里才重算卡片
	window.addEventListener("resize", refreshGeometry, { passive: true });
	// 换页 / 壁纸模式与简洁模式变化 / 目录重排都会改变卡片位置，一并重算
	document.addEventListener("swup:page:view", refreshSoon);
	document.addEventListener("swup:content:replace", refreshGeometry);
	window.addEventListener("wallpaper-mode-change", refreshGeometry);
	window.addEventListener("simple-mode-change", refreshGeometry);
	document.addEventListener("toc:relayout", refreshGeometry);
	window.addEventListener("load", refreshSoon);
	// 首载渐显结束后再量一次（此时 pointer-events 已恢复，elementFromPoint 能命中卡片）
	document.addEventListener("mizuki:page:loaded", refreshGeometry);

	refreshSoon();
	retryUntilReady();
}

bind();
