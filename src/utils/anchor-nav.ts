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

/** 目标标题应该滚到的位置（页面坐标系，已考虑导航栏遮挡与顶到顶部的情形） */
export function anchorScrollTop(target: HTMLElement): number {
	const gap = config().offset;
	const absolute = target.getBoundingClientRect().top + window.scrollY;
	return Math.max(0, Math.round(absolute - navbarBottomPx() - gap));
}

/* 自绘平滑滚动（可取消：新的一次跳转会让旧的立刻停） */
let scrollToken = 0;

const easeInOutCubic = (t: number) =>
	t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

function smoothScrollTo(top: number, duration: number) {
	const token = ++scrollToken;
	const startTop = window.scrollY;
	const delta = top - startTop;
	if (Math.abs(delta) < 1) {
		window.scrollTo(0, top);
		return;
	}
	const durationMs = Math.max(1, duration);
	const startAt = performance.now();
	const step = () => {
		if (token !== scrollToken) return; // 被新的跳转接管
		const elapsed = performance.now() - startAt;
		const progress = Math.min(1, elapsed / durationMs);
		window.scrollTo(0, Math.round(startTop + delta * easeInOutCubic(progress)));
		if (progress < 1) requestAnimationFrame(step);
	};
	requestAnimationFrame(step);
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
		playAnchorFade(() => window.scrollTo(0, top), {
			fadeOut: cfg.longJumpFadeOut,
			fadeIn: cfg.longJumpFadeIn,
		});
		return true;
	}

	smoothScrollTo(top, cfg.smoothDuration);
	return false;
}
