import { Effect1, siteConfig } from "../config";
import {
	hideCardsForNavigation,
	replayEffect1Show,
	restoreCardsAfterNavigation,
} from "./card-effects";

/**
 * Small Swup transition controller.
 *
 * Contract:
 * - first paint and refresh are visible immediately;
 * - navigation fades the current content for a short, bounded interval;
 * - replaced content is revealed without waiting for fonts, images or height;
 * - every navigation can be finished at most once, and a timer is the safety net.
 */

type Timing = { fadeOut: number; fadeIn: number };

const CLASS_LEAVING = "swup-leaving";
const CLASS_ENTERING = "page-entering";
const SAFETY_MS = 1600;
const PROGRESS_MAX_BEFORE_FINISH = 0.86;

let progressElement: HTMLElement | null = null;
let progressBar: HTMLElement | null = null;
let progressIncrementTimer: ReturnType<typeof setTimeout> | null = null;
let progressFinishTimer: ReturnType<typeof setTimeout> | null = null;
let progressResetTimer: ReturnType<typeof setTimeout> | null = null;

function progress() {
	if (typeof document === "undefined") return null;
	progressElement ??= document.getElementById("page-progress");
	progressBar ??=
		progressElement?.querySelector<HTMLElement>(":scope > span") ?? null;
	return progressElement && progressBar
		? { element: progressElement, bar: progressBar }
		: null;
}

function clearProgressTimers(): void {
	if (progressIncrementTimer) clearTimeout(progressIncrementTimer);
	if (progressFinishTimer) clearTimeout(progressFinishTimer);
	if (progressResetTimer) clearTimeout(progressResetTimer);
	progressIncrementTimer = null;
	progressFinishTimer = null;
	progressResetTimer = null;
}

function setProgress(value: number): void {
	const node = progress();
	if (node) node.bar.style.transform = `scaleX(${Math.min(1, Math.max(0, value))})`;
}

function startProgress(): void {
	const node = progress();
	if (!node) return;
	clearProgressTimers();
	node.element.classList.remove("is-finishing");
	node.element.classList.add("is-active");
	setProgress(0.08);
	let value = 0.08;
	const tick = () => {
		value += (PROGRESS_MAX_BEFORE_FINISH - value) * 0.14;
		setProgress(value);
		progressIncrementTimer = setTimeout(tick, 260);
	};
	progressIncrementTimer = setTimeout(tick, 180);
}

function advanceProgress(value = 0.72): void {
	if (!progress()?.element.classList.contains("is-active")) return;
	if (progressIncrementTimer) clearTimeout(progressIncrementTimer);
	progressIncrementTimer = null;
	setProgress(value);
}

function finishProgress(): void {
	const node = progress();
	if (!node) return;
	if (!node.element.classList.contains("is-active")) {
		setProgress(0);
		return;
	}
	clearProgressTimers();
	node.element.classList.add("is-finishing");
	setProgress(1);
	progressFinishTimer = setTimeout(() => {
		node.element.classList.remove("is-active", "is-finishing");
		progressResetTimer = setTimeout(() => setProgress(0), 160);
	}, 180);
}

function numberOr(value: unknown, fallback: number): number {
	const n = Number(value);
	return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function timing(): Timing {
	const configured = (window as any)?.siteConfig?.pageTransition as
		| Partial<Timing>
		| undefined;
	const source =
		configured ??
		(siteConfig as { pageTransition?: Partial<Timing> }).pageTransition;
	return {
		fadeOut: numberOr(source?.fadeOut, 180),
		fadeIn: numberOr(source?.fadeIn, 220),
	};
}

const resolvedTiming = timing();
export const PAGE_FADE_OUT_MS = resolvedTiming.fadeOut;
export const PAGE_FADE_IN_MS = resolvedTiming.fadeIn;
export const PRERENDER_MAX_WAIT_MS = 0;

function featureEnabled(name: string): boolean {
	const key = `motion${name.charAt(0).toUpperCase()}${name.slice(1)}`;
	return document.documentElement.dataset[key] !== "off";
}

function publishTiming(): void {
	const root = document.documentElement;
	root.style.setProperty("--page-fade-out", `${PAGE_FADE_OUT_MS}ms`);
	root.style.setProperty("--page-fade-in", `${PAGE_FADE_IN_MS}ms`);
}

let leaveResolver: (() => void) | null = null;
let leavePromise: Promise<void> | null = null;
let leaveTimer: ReturnType<typeof setTimeout> | null = null;
let enterTimer: ReturnType<typeof setTimeout> | null = null;
let safetyTimer: ReturnType<typeof setTimeout> | null = null;
let leaving = false;

function clearTimer(name: "leave" | "enter" | "safety"): void {
	const timer =
		name === "leave" ? leaveTimer : name === "enter" ? enterTimer : safetyTimer;
	if (timer) clearTimeout(timer);
	if (name === "leave") leaveTimer = null;
	if (name === "enter") enterTimer = null;
	if (name === "safety") safetyTimer = null;
}

function finishLeave(): void {
	clearTimer("leave");
	const resolve = leaveResolver;
	leaveResolver = null;
	resolve?.();
}

function showNow(): void {
	clearTimer("safety");
	clearTimer("leave");
	clearTimer("enter");
	finishLeave();
	document.body.classList.remove(CLASS_LEAVING, CLASS_ENTERING);
	restoreCardsAfterNavigation();
	leaving = false;
	finishProgress();
}

async function startLeave(): Promise<void> {
	clearTimer("safety");
	clearTimer("enter");
	document.body.classList.remove(CLASS_ENTERING);
	const cardExit = hideCardsForNavigation();
	if (!leaving) {
		leaving = true;
		startProgress();
		if (featureEnabled("pageTransition")) {
			document.body.classList.add(CLASS_LEAVING);
		}
		leavePromise = new Promise<void>((resolve) => {
			leaveResolver = resolve;
		});
		const leaveMs = Math.max(
			Effect1.duration_hide,
			featureEnabled("pageTransition") ? PAGE_FADE_OUT_MS : 0,
		);
		leaveTimer = setTimeout(finishLeave, leaveMs + 24);
	}
	safetyTimer = setTimeout(showNow, SAFETY_MS);
	await Promise.all([leavePromise ?? Promise.resolve(), cardExit]);
}

function revealNewContent(): void {
	if (!leaving && !document.body.classList.contains(CLASS_LEAVING)) {
		showNow();
		return;
	}
	finishLeave();
	clearTimer("safety");
	if (!featureEnabled("pageTransition")) {
		document.body.classList.remove(CLASS_LEAVING, CLASS_ENTERING);
		leaving = false;
		finishProgress();
		return;
	}
	document.body.classList.add(CLASS_ENTERING);
	document.body.classList.remove(CLASS_LEAVING);
	enterTimer = setTimeout(() => {
		document.body.classList.remove(CLASS_ENTERING);
		enterTimer = null;
	}, PAGE_FADE_IN_MS + 40);
	leaving = false;
	finishProgress();
}

export function clearRegionEnterAnimations(): void {
	// Compatibility no-op. Removing .onload-animation made the transition
	// controller fight every page component's own animation.
}

export function prepareRegions(): void {
	if (typeof window === "undefined") return;
	try {
		(window as any).mobileTOCInit?.();
	} catch {
		// Optional controller.
	}
	try {
		(window as any).__tocLayoutRecompute?.();
	} catch {
		// Optional controller.
	}
}

type AnchorFadeOptions = { fadeOut?: number; fadeIn?: number };

export function playAnchorFade(
	update: () => void,
	options: AnchorFadeOptions = {},
): void {
	const fadeOut = numberOr(options.fadeOut, 180);
	const fadeIn = numberOr(options.fadeIn, 220);
	const regions = Array.from(
		document.querySelectorAll<HTMLElement>(
			"#main-grid, #banner-wrapper, #toc-inner-wrapper",
		),
	);
	for (const region of regions) {
		region.style.transition = `opacity ${fadeOut}ms ease`;
		region.style.opacity = "0";
	}
	setTimeout(() => {
		update();
		prepareRegions();
		requestAnimationFrame(() => {
			for (const region of regions) {
				region.style.transition = `opacity ${fadeIn}ms ease`;
				region.style.opacity = "1";
			}
			setTimeout(() => {
				for (const region of regions) {
					region.style.removeProperty("transition");
					region.style.removeProperty("opacity");
				}
			}, fadeIn + 32);
		});
	}, fadeOut);
}

let hooksInstalled = false;

function installHooks(): boolean {
	if (hooksInstalled) return true;
	const hooks = (window as any).swup?.hooks;
	if (!hooks?.on) return false;

	hooks.on("visit:start", () => {
		void startLeave();
	});
	hooks.before("animation:out:await", (_visit: unknown, args: any) => {
		if (args) args.skip = true;
		return startLeave();
	});
	hooks.on("content:replace", () => {
		advanceProgress(0.76);
		prepareRegions();
		replayEffect1Show();
	});
	hooks.on("page:view", () => {
		advanceProgress(1);
		prepareRegions();
		requestAnimationFrame(() => {
			requestAnimationFrame(() => revealNewContent());
		});
	});
	hooks.before("animation:in:await", (_visit: unknown, args: any) => {
		if (args) args.skip = true;
	});
	hooks.on("visit:error", () => {
		showNow();
	});
	hooksInstalled = true;
	return true;
}

function register(): void {
	if (installHooks()) return;
	document.addEventListener(
		"swup:enable",
		() => {
			installHooks();
		},
		{ once: true },
	);
}

function init(): void {
	if (typeof window === "undefined" || typeof document === "undefined") return;
	if ((window as any).__fgmagiTransitionReady) return;
	(window as any).__fgmagiTransitionReady = true;
	publishTiming();
	showNow();
	replayEffect1Show();
	register();
}

init();
