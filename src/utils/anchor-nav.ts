/**
 * 目录（锚点）跳转的统一实现：宽屏侧栏目录（TOC.astro 的 table-of-contents）
 * 与窄屏浮层目录（MobileTOC.svelte）共用，保证两边口径完全一致。
 *
 * 行为（全部来自 config: siteConfig.toc.navigation）：
 *   1. 目标标题落在「导航栏底边 + offset」之下，绝不被吸顶导航栏挡住；
 *      最上的位置就是文档顶部（不会滚出负值）。
 *   2. 平滑滚动用自绘 rAF 动画：原生 behavior:"smooth" 的时长/缓动不可控，
 *      这里用 easeInOutCubic + 可配时长，速度更慢也更平滑。
 *   3. 距离超过 longJumpViewports 个视口高度时，改用
 *      「文章卡片 + 目录一起渐变消失 → 瞬移到目标 → 预渲染 → 统一渐变显示」
 *      （复用 src/utils/page-transition.ts 的 playAnchorFade）。
 */

import { siteConfig } from "../config";
import { playAnchorFade } from "./page-transition";

interface TocNavConfig {
	offset?: number;
	smoothDuration?: number;
	longJumpViewports?: number;
	longJumpFadeOut?: number;
	longJumpFadeIn?: number;
}

const DEFAULTS: Required<TocNavConfig> = {
	offset: 12,
	smoothDuration: 700,
	longJumpViewports: 1.5,
	longJumpFadeOut: 200,
	longJumpFadeIn: 250,
};

/** 读取配置：优先 window.siteConfig（ConfigCarrier 注入的同源配置），回退构建期 config */
function config(): Required<TocNavConfig> {
	const fromWindow = (window as any)?.siteConfig?.toc
		?.navigation as TocNavConfig | undefined;
	const fromModule = (siteConfig as any)?.toc?.navigation as
		| TocNavConfig
		| undefined;
	const pick = (key: keyof TocNavConfig) => {
		const raw = fromWindow?.[key] ?? fromModule?.[key];
		const num = Number(raw);
		return Number.isFinite(num) && num >= 0 ? num : DEFAULTS[key];
	};
	return {
		offset: pick("offset"),
		smoothDuration: pick("smoothDuration"),
		longJumpViewports: pick("longJumpViewports"),
		longJumpFadeOut: pick("longJumpFadeOut"),
		longJumpFadeIn: pick("longJumpFadeIn"),
	};
}

/** 吸顶导航栏底边（px）；读不到真实底边时回退 96px（≈ 顶栏 + 间距） */
function navbarBottomPx(): number {
	const navEl = document.getElementById("navbar");
	const rect = navEl ? navEl.getBoundingClientRect() : null;
	return rect && rect.bottom > 0 ? rect.bottom : 96;
}

/**
 * 目录高亮的判定线（视口坐标 px）：导航栏底边 + 跳转偏移 + 一点容差。
 *
 * ⚠ 必须与 anchorScrollTop() 的落点同源：跳转后标题正好停在
 *   「导航栏底边 + offset」处，如果判定线只取导航栏底边，这个标题会被判成
 *   「还没越过线」，高亮就落到上一条标题上（实测的错位现象）。
 */
export function activeHeadingLinePx(): number {
	return navbarBottomPx() + config().offset + 4;
}

/** 目标标题应该滚到的位置（页面坐标系，已考虑导航栏遮挡与顶到顶部的情形） */
export function anchorScrollTop(target: HTMLElement): number {
	const gap = config().offset;
	const absolute = target.getBoundingClientRect().top + window.scrollY;
	return Math.max(0, Math.round(absolute - navbarBottomPx() - gap));
}

/** 文档能滚到的最大位置（末尾几章的标题滚不到判定线，需要单独处理，见 TOC.currentIndex） */
export function maxScrollY(): number {
	return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
}

/** 目标标题实际能滚到的位置：受文档底部限制（末尾的标题滚不到「导航栏底边 + offset」） */
export function anchorScrollTopClamped(target: HTMLElement): number {
	return Math.min(anchorScrollTop(target), maxScrollY());
}

/* 自绘平滑滚动（可取消：新的一次跳转会让旧的立刻停） */
let scrollToken = 0;

const easeInOutCubic = (t: number) =>
	t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/**
 * main.css 给 html 设了全局 `scroll-behavior: smooth`，
 * 于是每一次 `window.scrollTo(0, y)` 都会被浏览器再包一层平滑动画：
 *   · 自绘 rAF 动画每帧发起的滚动互相打断 ⇒ 落点漂移（标题被导航栏挡住）；
 *   · 「淡出→瞬移」的长距离跳转也会被拖成慢慢滚。
 * 所以动画期间临时把 html 的内联 scroll-behavior 设成 auto，结束后还原。
 */
const beginInstantScroll = () => {
	const root = document.documentElement;
	const prev = root.style.scrollBehavior;
	root.style.scrollBehavior = "auto";
	return () => {
		root.style.scrollBehavior = prev;
	};
};

function smoothScrollTo(top: number, duration: number) {
	const token = ++scrollToken;
	const startTop = window.scrollY;
	const delta = top - startTop;
	const restoreBehavior = beginInstantScroll();
	if (Math.abs(delta) < 1) {
		window.scrollTo(0, top);
		restoreBehavior();
		return;
	}
	const durationMs = Math.max(1, duration);
	const startAt = performance.now();
	const step = () => {
		if (token !== scrollToken) {
			restoreBehavior(); // 被新的跳转接管
			return;
		}
		const elapsed = performance.now() - startAt;
		const progress = Math.min(1, elapsed / durationMs);
		window.scrollTo(0, Math.round(startTop + delta * easeInOutCubic(progress)));
		if (progress < 1) {
			requestAnimationFrame(step);
		} else {
			restoreBehavior();
		}
	};
	requestAnimationFrame(step);
}

/**
 * 跳转后的收尾跟随。
 *
 * 正文图片是懒加载、且没有写死宽高：跳转过程中它们陆续进入视口、把版面撑高，
 * 目标标题在跳转结束之后还会继续位移（实测长距离跳转会差 200px 以上，
 * 于是标题被顶到导航栏上面，看起来就像「再点一次才到位」）。
 * 这里等跳转动画跑完（delay）之后，用一小段时间补正到最终位置；
 * 用户一旦自己滚动/按键、或发起新的跳转，立刻停手。
 */
let stopFollow: (() => void) | null = null;

function followTarget(target: HTMLElement, delay: number) {
	stopFollow?.(); // 新的跳转接管：上一次的跟随立即停止（否则会把页面拽回旧目标）
	const CANCEL_EVENTS = ["wheel", "touchstart", "keydown", "mousedown"];
	let active = true;
	let ticks = 0;
	const stop = () => {
		if (!active) return;
		active = false;
		if (stopFollow === stop) stopFollow = null;
		CANCEL_EVENTS.forEach((type) => window.removeEventListener(type, stop));
	};
	stopFollow = stop;
	CANCEL_EVENTS.forEach((type) =>
		window.addEventListener(type, stop, { passive: true }),
	);
	const step = () => {
		if (!active) return;
		const top = anchorScrollTopClamped(target);
		if (Math.abs(window.scrollY - top) > 2) {
			const restoreBehavior = beginInstantScroll();
			window.scrollTo(0, top);
			restoreBehavior();
		}
		if (++ticks < 9) window.setTimeout(step, 150);
		else stop();
	};
	window.setTimeout(step, Math.max(0, delay));
}

/**
 * 跳到某个标题：按距离选择「平滑滚动」或「渐变消失→瞬移→预渲染→渐变显示」。
 * 返回是否采用了长距离（渐变）方案，供调用方决定是否还要做高亮抑制等收尾。
 */
export function jumpToHeading(id: string): boolean {
	if (typeof window === "undefined") return false;
	const target = document.getElementById(id);
	if (!target) return false;

	const cfg = config();
	const top = anchorScrollTop(target);
	const distance = Math.abs(top - window.scrollY);
	const longJumpPx = window.innerHeight * cfg.longJumpViewports;

	if (cfg.longJumpViewports > 0 && distance > longJumpPx) {
		followTarget(target, cfg.longJumpFadeOut + 120);
		playAnchorFade(
			() => {
				// 瞬移必须真的瞬移：全局 smooth 会把「瞬移」拖成一段慢滚
				const restoreBehavior = beginInstantScroll();
				window.scrollTo(0, top);
				restoreBehavior();
			},
			{
				fadeOut: cfg.longJumpFadeOut,
				fadeIn: cfg.longJumpFadeIn,
			},
		);
		return true;
	}

	followTarget(target, cfg.smoothDuration + 120);
	smoothScrollTo(top, cfg.smoothDuration);
	return false;
}
