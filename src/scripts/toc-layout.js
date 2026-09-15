/**
 * 目录（TOC）侧栏布局控制器（客户端，仅浏览器）。任务二 B + C 的实现载体。
 *
 * 职责一（宽度模式 C）：写入 `--viewport-w`（clientWidth，排除滚动条），并判定
 *   `html[data-toc-layout="desktop" | "narrow"]`：
 *   - 仅「含 TOC 的桌面文章页」参与收窄；首页/列表/相册等页面不参与（≥1024 时移除属性，
 *     <1024 时置 narrow 以保留移动端目录入口）；
 *   - desktop 条件：innerWidth ≥ 1024 且 clientWidth − 2*(railPx + gutterPx) ≥ articleMinPx，
 *     且右轨可用宽度 ≥ MIN_TOC_W（避免“显示但 0 宽”）；
 *   - desktop 时 `--content-width` 由 CSS 规则覆盖为 `--article-width`（见 variables.styl）。
 *
 * 职责二（TOC 溢出滚动 B）：写入 `--toc-top` / `--toc-max-h`（px）：
 *   - navbarBottom = #navbar 的 getBoundingClientRect().bottom（常驻吸顶导航栏底部必须纳入）；
 *   - tocTop = max(BASE_TOC_TOP, navbarBottom + NAV_GAP)；
 *   - bottomReserve = innerHeight − #back-to-top-btn rect.top + BTN_GAP
 *     （按钮 .hide 时仅透明度/位移变化，rect 仍有效 → 始终预留；移动端按钮 display:none 时不计）；
 *   - maxH = max(MIN_TOC_H, innerHeight − tocTop − bottomReserve)；
 *   滚动容器为 <table-of-contents> 自身（CSS 读 --toc-max-h）。
 *
 * 重算时机：load / rAF 防抖 resize / orientationchange / swup:page:view / content:replace /
 * 模式翻转（wallpaper-mode-change、simple-mode-change）/ TOC 初始化后 300ms。**不监听 scroll**。
 * 计算完成后派发 `toc:relayout`，供 TOC 组件重新居中高亮项。
 */

const NAV_GAP = 16; // 导航栏底部与 TOC 顶部间距（px）
const BTN_GAP = 16; // 回顶按钮与 TOC 预留区间距（px）
const BASE_TOC_TOP = 88; // 基准顶部（≈5.5rem @16px，无导航栏/未布局时的兜底）
const MIN_TOC_H = 200; // TOC 可视高度下限
// 右轨最小可用宽度（低于则退化 narrow）。
// 不变量：--toc-card-base + --article-gutter ≥ MIN_TOC_W
//   当前 = 7.92rem + 1rem = 8.92rem；根字号 13.6px 时 ≈ 121.3px。
//   取 96 而非 160：预留改小后目录卡基准宽度本身就接近该量级，
//   门槛过高会让「目录存在且可读」的视口区间被误判为 narrow（目录整段消失）。
const MIN_TOC_W = 96;
const DESKTOP_MIN_VIEWPORT = 1024; // 桌面判定最小窗口宽
const MOBILE_ENTRY_MAX = 1280; // 非文章/无侧栏目录时保留移动端入口的最大窗口宽（对应原 lg 断点语义）

let probe = null;
let rafId = 0;

function getProbe() {
	if (probe && probe.isConnected) return probe;
	probe = document.createElement("div");
	probe.setAttribute("aria-hidden", "true");
	probe.style.cssText =
		"position:absolute;left:-9999px;top:0;height:0;visibility:hidden;pointer-events:none;width:0";
	(document.body || document.documentElement).appendChild(probe);
	return probe;
}

/** 读取当前 root 字号（pageScaling 会改变它，rem 换算必须以此为基准） */
function rootFontSize() {
	const fs = parseFloat(
		getComputedStyle(document.documentElement).fontSize || "16",
	);
	return Number.isFinite(fs) && fs > 0 ? fs : 16;
}

/** 解析形如 "60rem" / "1rem" 的简单长度；失败时按 rem 默认值回退 */
function remVarPx(name, fallbackRem) {
	const raw = getComputedStyle(document.documentElement)
		.getPropertyValue(name)
		.trim();
	const m = /^(-?[\d.]+)rem$/.exec(raw);
	if (m) return parseFloat(m[1]) * rootFontSize();
	return fallbackRem * rootFontSize();
}

/**
 * 用离屏探针把一个 CSS 长度变量解析为 px（可正确处理 clamp()/calc()/vw 等表达式；
 * 例如 --toc-rail-width 配成 "13rem"，或将来配成 clamp(13rem, 16vw, 18rem) 等）。
 */
function measureVarPx(name, fallbackRem) {
	try {
		const el = getProbe();
		el.style.width = `var(${name}, 0px)`;
		const w = el.getBoundingClientRect().width;
		if (w > 0) return w;
	} catch {
		/* 回退到 rem 解析 */
	}
	return remVarPx(name, fallbackRem);
}

function isArticlePage() {
	return (
		window.location.pathname.includes("/posts/") ||
		!!document.querySelector(".custom-md, .markdown-content, .prose")
	);
}

/**
 * 是否处于「侧栏目录（rail）」模式：仅该模式参与文章收窄。
 * float 模式（FloatingTOC）本次完全不动 —— 无 rail 时不改写 --content-width。
 */
function hasSidebarRail() {
	return !!document.getElementById("toc-rail-wrapper");
}

/** 计算并写入 --viewport-w、html[data-toc-layout] */
let lastLayoutMode = null;
/** 只有「紧跟窗口尺寸变化」的那一次计算允许播收放动画（首帧/换页不播，避免叠动画） */
let layoutAnimArmed = false;

function applyLayoutMode() {
	const root = document.documentElement;
	const vw = root.clientWidth; // 排除滚动条，精确
	root.style.setProperty("--viewport-w", `${vw}px`);

	const railPx = measureVarPx("--toc-rail-width", 16);
	const gutterPx = measureVarPx("--article-gutter", 1);
	const articleMinPx = measureVarPx("--article-min-width", 60);

	const wideEnough =
		window.innerWidth >= DESKTOP_MIN_VIEWPORT &&
		vw - 2 * (railPx + gutterPx) >= articleMinPx;

	const articlePx = measureVarPx("--article-width", 60);
	const tocAvailPx = (vw - articlePx) / 2 - gutterPx;

	const railPage = hasSidebarRail() && isArticlePage();
	const desktop = railPage && wideEnough && tocAvailPx >= MIN_TOC_W;

	let mode;
	if (desktop) {
		root.setAttribute("data-toc-layout", "desktop");
		mode = "desktop";
	} else if (railPage || window.innerWidth < MOBILE_ENTRY_MAX) {
		// 侧栏目录文章页但宽度不足 → 退化移动端入口；
		// 非文章/float 模式且窗口较窄（< lg 1280）→ 同样保留移动端入口（维持原行为）
		root.setAttribute("data-toc-layout", "narrow");
		mode = "narrow";
	} else {
		// 非文章页 / float 模式且大屏：不显示移动端入口（保持原有大屏隐藏行为）
		root.removeAttribute("data-toc-layout");
		mode = "none";
	}

	// 26.09.14：只有「视口尺寸变化导致的宽窄模式切换」才播收放动画
	//（layoutAnimArmed 只在 resize / orientationchange 后为真，且一次性）；
	// 首帧、换页、模式切换等其它原因导致的差异都不播，避免与页面渐变叠加。
	const armed = layoutAnimArmed;
	layoutAnimArmed = false;
	if (lastLayoutMode !== null && lastLayoutMode !== mode && armed) {
		scheduleRailTransition(lastLayoutMode, mode);
	}
	lastLayoutMode = mode;
}

/* ------------------------------------------------------------------ */
/* 目录收放动画（窄↔宽切换）                                            */
/* 要求：导航栏按键弹性左移/右移（宽度 0 ↔ 自然宽），                       */
/*      目录卡收小/变大并弹性移动到按键位置。                                */
/* ------------------------------------------------------------------ */

const SPRING_EASE = "cubic-bezier(0.34, 1.56, 0.64, 1)";
const RAIL_ANIM_MS = 340;
let railAnimTimers = [];

function prefersReducedMotion() {
	return !!(
		window.matchMedia &&
		window.matchMedia("(prefers-reduced-motion: reduce)").matches
	);
}

function clearRailAnimTimers() {
	railAnimTimers.forEach((t) => clearTimeout(t));
	railAnimTimers = [];
}

function railParts() {
	return {
		rail: document.getElementById("toc-rail-wrapper"),
		card: document.getElementById("toc-inner-wrapper"),
		btn: document.getElementById("mobile-toc-switch"),
	};
}

/** 导航栏目录按键：0 ↔ 自然宽弹性展开/收起（两侧按钮随之前后移动） */
function animateNavbarButton(btn, expand) {
	if (!btn) return;
	const natural = btn.offsetWidth || 44;
	btn.style.overflow = "hidden";
	if (expand) {
		// 先钉到 0 宽并强制重排，再过渡到自然宽 —— 否则同帧内等于没有过渡
		btn.style.transition = "none";
		btn.style.width = "0px";
		btn.style.opacity = "0";
		btn.style.pointerEvents = "none";
		void btn.offsetWidth;
		btn.style.transition = `width ${RAIL_ANIM_MS}ms ${SPRING_EASE}, opacity ${Math.round(RAIL_ANIM_MS * 0.7)}ms ease`;
		btn.style.width = `${natural}px`;
		btn.style.opacity = "1";
	} else {
		btn.style.transition = `width ${RAIL_ANIM_MS}ms ${SPRING_EASE}, opacity ${Math.round(RAIL_ANIM_MS * 0.5)}ms ease`;
		btn.style.width = "0px";
		btn.style.opacity = "0";
	}
	railAnimTimers.push(
		setTimeout(() => {
			btn.style.cssText = "";
		}, RAIL_ANIM_MS + 60),
	);
}

/**
 * 算出「目录卡收进按键位置」所需的 transform-origin 与 transform。
 * 统一缩放（按宽度比），视觉中心取卡片上部一段（目录卡可能高达 --toc-max-h，
 * 若按整卡高度缩放会缩成一条线）。
 */
function collapsedTransform(cardRect, btnRect) {
	if (cardRect.width < 1 || btnRect.width < 1) return null;
	const scale = Math.max(0.04, Math.min(1, btnRect.width / cardRect.width));
	const localX = cardRect.width / 2;
	const localY = Math.min(cardRect.height, 240) / 2;
	const tx =
		btnRect.left + btnRect.width / 2 - (cardRect.left + localX);
	const ty = btnRect.top + btnRect.height / 2 - (cardRect.top + localY);
	return {
		origin: `${Math.round(localX)}px ${Math.round(localY)}px`,
		transform: `translate(${Math.round(tx)}px, ${Math.round(ty)}px) scale(${scale.toFixed(3)})`,
	};
}

function playRailTransition(from, to) {
	if (from === "none" || to === "none") return; // 非文章页切换不参与收放动画
	if (prefersReducedMotion()) return;
	clearRailAnimTimers();
	const { rail, card, btn } = railParts();
	if (!rail || !card || !btn) return;

	const expanding = to === "desktop"; // narrow → desktop：目录展开

	// 先把新模式落实到布局（按键的 display、rail 的可见性都由 data-toc-layout 驱动），
	// 否则量到的还是旧几何、动画起点会跳。
	void document.documentElement.offsetHeight;

	if (!expanding) {
		// 收起过程中 CSS 已把 rail 隐藏（narrow），这里临时强制可见，动画结束再交还 CSS
		rail.style.visibility = "visible";
		rail.style.opacity = "1";
	}

	// 展开方向（narrow → desktop）时，按键在 desktop 下是 display:none，量不到几何；
	// 先临时显示它（保持自然宽）再量起点，动画收尾统一 cssText="" 交还 CSS。
	const buttonHidden = window.getComputedStyle(btn).display === "none";
	if (buttonHidden) btn.style.display = "inline-flex";

	const collapsed = collapsedTransform(
		card.getBoundingClientRect(),
		btn.getBoundingClientRect(),
	);

	animateNavbarButton(btn, !expanding);

	if (collapsed) {
		card.style.transformOrigin = collapsed.origin;
		if (expanding) {
			// 同一帧内先落到「贴住按键」的初始态：否则 rails 变为可见那一帧会闪一下原尺寸
			card.style.transition = "none";
			card.style.transform = collapsed.transform;
			card.style.opacity = "0";
			void card.offsetWidth; // 强制提交起始态
		}
		requestAnimationFrame(() => {
			card.style.transition = `transform ${RAIL_ANIM_MS}ms ${SPRING_EASE}, opacity ${Math.round(RAIL_ANIM_MS * 0.7)}ms ease`;
			if (expanding) {
				card.style.transform = "translate(0px, 0px) scale(1)";
				card.style.opacity = "1";
			} else {
				card.style.transform = collapsed.transform;
				card.style.opacity = "0";
			}
		});
	}

	railAnimTimers.push(
		setTimeout(() => {
			card.style.cssText = "";
			rail.style.visibility = "";
			rail.style.opacity = "";
		}, RAIL_ANIM_MS + 80),
	);
}

/** 与几何重算同拍（rAF 合并），避免同一帧里反复起动画 */
function scheduleRailTransition(from, to) {
	requestAnimationFrame(() => playRailTransition(from, to));
}

/** 计算并写入 --toc-top / --toc-max-h（TOC 溢出滚动与按钮避让） */
function applyTocGeometry() {
	const innerWrapper = document.getElementById("toc-inner-wrapper");
	if (!innerWrapper) return; // float 模式或未渲染侧栏目录：保持 CSS 兜底值

	const root = document.documentElement;
	const navbar = document.getElementById("navbar");
	const navBottom = navbar ? navbar.getBoundingClientRect().bottom : 0;
	const tocTop = Math.max(BASE_TOC_TOP, navBottom + NAV_GAP);

	let bottomReserve = BTN_GAP;
	const backBtn = document.getElementById("back-to-top-btn");
	if (backBtn) {
		const r = backBtn.getBoundingClientRect();
		// .hide 只改透明度/位移，rect 有效；移动端 display:none 时高度为 0 → 不计预留
		if (r.height > 0) {
			bottomReserve = window.innerHeight - r.top + BTN_GAP;
		}
	}

	const maxH = Math.max(
		MIN_TOC_H,
		window.innerHeight - tocTop - bottomReserve,
	);
	root.style.setProperty("--toc-top", `${Math.round(tocTop)}px`);
	root.style.setProperty("--toc-max-h", `${Math.round(maxH)}px`);
}

function recompute() {
	if (typeof document === "undefined") return;
	applyLayoutMode();
	applyTocGeometry();
	// 通知 TOC 组件重新居中当前高亮项（尺寸/位置变化后）
	document.dispatchEvent(new CustomEvent("toc:relayout"));
}

/** rAF 合并多次触发（resize / 事件风暴只算一次） */
function schedule() {
	if (rafId) return;
	rafId = requestAnimationFrame(() => {
		rafId = 0;
		recompute();
	});
}

function install() {
	if (typeof window === "undefined" || typeof document === "undefined")
		return;

	// 26.09.14：暴露同步重算入口。MainGridLayout 的预渲染帧要在同一帧内量出目录几何
	// （--toc-top/--toc-max-h、html[data-toc-layout]）后再开始渐变；本模块自身的重算走 rAF，
	// 赶不上那一帧，故必须提供同步调用点。
	window.__tocLayoutRecompute = recompute;

	// 首载
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", () => {
			recompute();
			setTimeout(recompute, 300); // TOC 组件初始化后（含 regenerateTOC 延迟）再校准一次
		});
	} else {
		recompute();
		setTimeout(recompute, 300);
	}
	window.addEventListener("load", schedule);

	// 尺寸变化（rAF 防抖）
	// ——只有这两类事件允许触发「目录收放动画」（见 applyLayoutMode 的 layoutAnimArmed）
	window.addEventListener(
		"resize",
		() => {
			layoutAnimArmed = true;
			schedule();
		},
		{ passive: true },
	);
	window.addEventListener(
		"orientationchange",
		() => {
			layoutAnimArmed = true;
			schedule();
		},
		{ passive: true },
	);

	// 模式翻转：壁纸模式（banner/fullscreen/none）与简洁模式都会改变网格/导航几何
	window.addEventListener("wallpaper-mode-change", schedule);
	window.addEventListener("simple-mode-change", schedule);

	// swup 生命周期：新内容就位后重算（DOM 级事件，不依赖实例 hook 注册时机）
	document.addEventListener("swup:content:replace", schedule);
	document.addEventListener("astro:page-load", () => {
		recompute();
		setTimeout(recompute, 300);
	});
	document.addEventListener("swup:page:view", schedule);

	// 明确不监听 scroll：吸顶导航常驻，TOC 几何与滚动无关
}

install();
