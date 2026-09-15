/**
 * 导航栏 / 主卡片「重合交界描边」。
 *
 * 需求背景：下拉后，导航栏与主卡片（文章卡片、友链卡片、图片卡片等）宽度很多时候完全一致，
 * 两者叠在一起时分不清边界。这里在**导航栏下边界**处、**只对真正被导航栏压住的那段卡片宽度**
 * 画一条主题色横线（带阴影，观感是横线而不是圆角矩形的下边线），
 * 重合出现/消失都走 opacity 渐变。
 *
 * 实现要点：
 *   · 只在 scroll / resize / swup 换页 / 壁纸与简洁模式变化 / 目录重排后，按 rAF 节流重算，
 *     不做常驻逐帧计算；
 *   · 判「重合」= 该卡片在竖直方向上跨过导航栏底边（navBottom 落在卡片内有交集）；
 *   · 采样点横跨导航栏内宽（去掉两端 8px），命中后向上找「有可见背景」的那一层当卡片，
 *     再把所有被压住卡片的横向区间合并 ⇒ 得到「仅重合部分」的区间。
 */

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
 * ⚠ 为什么取最宽而不是「第一个有背景的祖先」（上一版的做法，用户反馈「渐变不稳定、
 *   存在丢失」）：命中点下面是普通人无法预测的内容——代码块、引用块、license 块、图片、
 *   左右磁贴……它们各自都有背景，取第一个会让线长随滚动内容不断变化、甚至短到被丢弃。
 *   卡片是这些内部块的共同祖先，取「最宽且不超过导航栏宽度」的那个，长度才稳定，
 *   也对应需求里的「主卡片（文章卡片、友链卡片、图片卡片等）」。
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
					best = { left: rect.left, right: rect.right };
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

function update() {
	rafId = 0;
	const navCard = document.querySelector(NAV_CARD_SELECTOR);
	const el = ensureSeparator();
	if (!navCard || !el) return;

	const nav = navCard.getBoundingClientRect();
	const navBottom = Math.round(nav.bottom);
	// 导航栏不在视口内 / 尺寸异常 → 直接隐藏
	if (nav.width <= 0 || navBottom <= 0 || navBottom >= window.innerHeight - 1) {
		hide(el);
		return;
	}

	const innerLeft = nav.left + EDGE_INSET;
	const innerRight = nav.right - EDGE_INSET;
	if (innerRight - innerLeft < MIN_RUN_PX) {
		hide(el);
		return;
	}

	const card = findMainCard(nav, navBottom, innerLeft, innerRight);
	if (!card) {
		hide(el);
		return;
	}

	const left = Math.round(Math.max(card.left, innerLeft));
	const right = Math.round(Math.min(card.right, innerRight));
	const width = right - left;
	if (width < MIN_RUN_PX) {
		hide(el);
		return;
	}
	const background = lineGradient(width);
	// 只有几何真的变了才写样式，减少无谓的重排/重绘
	const key = `${left}|${width}|${navBottom}`;
	if (key !== lastKey) {
		lastKey = key;
		el.style.left = `${left}px`;
		el.style.width = `${width}px`;
		el.style.top = `${navBottom}px`;
		el.style.background = background;
	}
	if (!el.classList.contains("is-visible")) el.classList.add("is-visible");
}

function schedule() {
	if (rafId) return;
	rafId = window.requestAnimationFrame(update);
}

function bind() {
	if (window.__navbarCardSeparatorBound) return;
	window.__navbarCardSeparatorBound = true;
	ensureSeparator();
	window.addEventListener("scroll", schedule, { passive: true });
	window.addEventListener("resize", schedule, { passive: true });
	// 换页 / 壁纸模式与简洁模式变化 / 目录重排都会改变卡片位置，一并重算
	document.addEventListener("swup:page:view", schedule);
	document.addEventListener("swup:content:replace", schedule);
	window.addEventListener("wallpaper-mode-change", schedule);
	window.addEventListener("simple-mode-change", schedule);
	document.addEventListener("toc:relayout", schedule);
	window.addEventListener("load", schedule);
	schedule();
}

bind();
