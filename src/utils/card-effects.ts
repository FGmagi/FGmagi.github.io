import { Effect1, Effect2 } from "../config";

type VisibilityPredicate = (card: HTMLElement) => boolean;

type FilterOptions = {
	animate?: boolean;
	group?: Element | null;
	layoutContainer?: HTMLElement | null;
	moveAlong?: HTMLElement | null;
	animateLayoutHeight?: boolean;
	measureLayout?: () => (() => void) | undefined;
	afterHide?: (cards: HTMLElement[]) => void;
	afterReveal?: (cards: HTMLElement[]) => void;
};

type SavedStyle = {
	transition: string;
	transform: string;
	opacity: string;
	willChange: string;
};

type ActiveFilterRun = {
	cancel: () => void;
	done: Promise<void>;
};

const activeFilterRuns = new WeakMap<Element, ActiveFilterRun>();
const activeHeightRuns = new WeakMap<HTMLElement, { cancel: () => void }>();
const activeHeightHosts = new Set<HTMLElement>();
const HIDDEN_CLASS = "effect2-hidden";
const FILTER_CLASS = "effect2-card";
const HIDING_CLASS = "effect2-hiding";
const ENTERING_CLASS = "effect2-entering";
const REVEALING_CLASS = "effect2-revealing";
const MOVING_CLASS = "effect2-moving";
const MEASURING_CLASS = "effect2-measuring";
const KEEPING_CLASS = "effect2-keeping";

function wait(ms: number): Promise<void> {
	return new Promise((resolve) =>
		window.setTimeout(resolve, Math.max(0, ms)),
	);
}

function nextFrame(): Promise<void> {
	return new Promise((resolve) =>
		window.requestAnimationFrame(() => resolve()),
	);
}

function getTransitionProperty(animation: Animation): string | null {
	const property = (animation as Animation & { transitionProperty?: string })
		.transitionProperty;
	return typeof property === "string" ? property : null;
}

function getAnimationName(animation: Animation): string | null {
	const name = (animation as Animation & { animationName?: string })
		.animationName;
	return typeof name === "string" ? name : null;
}

function syncEffect2CssTiming(): void {
	const style = document.documentElement.style;
	style.setProperty("--effect2-duration-hide", `${Effect2.duration_hide}ms`);
	style.setProperty("--effect2-duration-move", `${Effect2.duration_move}ms`);
	style.setProperty("--effect2-duration-show", `${Effect2.duration_show}ms`);
}

async function waitForCssMotion(
	elements: Iterable<HTMLElement>,
	matches: (animation: Animation) => boolean,
	fallbackMs: number,
	cancelledPromise: Promise<void>,
): Promise<void> {
	if (fallbackMs <= 0) return;

	// Let the style mutation create the CSS transition/animation, then wait for
	// those exact animations. JS timers alone can start before the next CSS
	// frame, which makes a shortened Effect2 move clear transform too early.
	await Promise.race([nextFrame(), cancelledPromise]);
	const animations = new Set<Animation>();
	for (const element of new Set(elements)) {
		for (const animation of element.getAnimations({ subtree: false })) {
			if (animation.playState !== "finished" && matches(animation)) {
				animations.add(animation);
			}
		}
	}

	if (!animations.size) {
		await Promise.race([wait(fallbackMs), cancelledPromise]);
		return;
	}

	await Promise.race([
		Promise.all(
			Array.from(animations, (animation) =>
				animation.finished.catch(() => undefined),
			),
		),
		cancelledPromise,
	]);
}

function getEffect1Animations(
	root: HTMLElement,
	animationName: "Effect1_hide" | "Effect1_show",
): Animation[] {
	const elements = [
		root,
		...Array.from(root.children).filter(
			(child): child is HTMLElement => child instanceof HTMLElement,
		),
	];
	return elements.flatMap((element) =>
		element
			.getAnimations({ subtree: false })
			.filter(
				(animation) => getAnimationName(animation) === animationName,
			),
	);
}

async function waitForEffect1Phase(
	root: HTMLElement,
	animationName: "Effect1_hide" | "Effect1_show",
	deadline: number,
): Promise<void> {
	const remaining = Math.max(0, deadline - performance.now());
	if (remaining <= 0) {
		for (const animation of getEffect1Animations(root, animationName)) {
			try {
				animation.finish();
			} catch {
				/* A cancelled animation needs no further work. */
			}
		}
		return;
	}

	const animations = getEffect1Animations(root, animationName);
	if (!animations.length) return;

	await Promise.race([
		Promise.all(
			animations.map((animation) =>
				animation.finished.catch(() => undefined),
			),
		),
		wait(remaining),
	]);

	// A stalled/reduced-motion animation must not leave the host invisible.
	for (const animation of animations) {
		if (animation.playState === "finished") continue;
		try {
			animation.finish();
		} catch {
			/* The host visibility cleanup below remains authoritative. */
		}
	}
}

function isHidden(card: HTMLElement): boolean {
	return (
		hasHiddenState(card) || window.getComputedStyle(card).display === "none"
	);
}

function hasHiddenState(card: HTMLElement): boolean {
	return (
		card.classList.contains(HIDDEN_CLASS) ||
		card.classList.contains("hidden") ||
		card.hidden ||
		card.style.display === "none"
	);
}

function saveStyle(card: HTMLElement): SavedStyle {
	return {
		transition: card.style.transition,
		transform: card.style.transform,
		opacity: card.style.opacity,
		willChange: card.style.willChange,
	};
}

function restoreStyle(card: HTMLElement, saved: SavedStyle): void {
	card.style.transition = saved.transition;
	card.style.transform = saved.transform;
	card.style.opacity = saved.opacity;
	card.style.willChange = saved.willChange;
}

function clearFilterClasses(card: HTMLElement): void {
	card.classList.remove(
		HIDING_CLASS,
		ENTERING_CLASS,
		REVEALING_CLASS,
		MOVING_CLASS,
		KEEPING_CLASS,
		MEASURING_CLASS,
	);
	card.style.removeProperty("--effect2-keep-opacity");
}

function normalizeImmediately(
	cards: HTMLElement[],
	desired: Map<HTMLElement, boolean>,
): void {
	for (const card of cards) {
		card.classList.add(FILTER_CLASS);
		clearFilterClasses(card);
		card.classList.toggle(HIDDEN_CLASS, !desired.get(card));
	}
}

/**
 * Effect2: hide removed cards first, move the surviving cards with FLIP, then
 * reveal newly matching cards at their final positions.
 */
export async function applyCardFilter(
	cards: Iterable<HTMLElement>,
	shouldShow: VisibilityPredicate,
	options: FilterOptions = {},
): Promise<void> {
	if (typeof window === "undefined") return;
	syncEffect2CssTiming();

	const uniqueCards = Array.from(new Set(cards)).filter(
		(card) => card?.isConnected,
	);
	if (!uniqueCards.length) return;

	const group =
		options.group ??
		uniqueCards[0]?.parentElement ??
		document.documentElement;
	activeFilterRuns.get(group)?.cancel();

	const desired = new Map<HTMLElement, boolean>();
	for (const card of uniqueCards) desired.set(card, shouldShow(card));

	const animate = options.animate !== false;
	if (
		!animate ||
		Effect2.duration_hide + Effect2.duration_move + Effect2.duration_show <=
			0
	) {
		normalizeImmediately(uniqueCards, desired);
		options.afterHide?.(uniqueCards.filter((card) => !desired.get(card)));
		options.afterReveal?.(uniqueCards.filter((card) => desired.get(card)));
		return;
	}

	let cancelled = false;
	let resolveCancelled: (() => void) | null = null;
	const cancelledPromise = new Promise<void>((resolve) => {
		resolveCancelled = resolve;
	});
	let resolveDone: (() => void) | null = null;
	const donePromise = new Promise<void>((resolve) => {
		resolveDone = resolve;
	});
	const savedStyles = new Map(
		uniqueCards.map((card) => [card, saveStyle(card)]),
	);
	const layoutContainer = options.layoutContainer?.isConnected
		? options.layoutContainer
		: null;
	const animateLayoutHeight = options.animateLayoutHeight === true;
	const moveAlong = options.moveAlong?.isConnected ? options.moveAlong : null;
	const layoutStartHeight = layoutContainer?.getBoundingClientRect().height;
	const layoutSavedHeight = layoutContainer?.style.height ?? "";
	const layoutSavedTransition = layoutContainer?.style.transition ?? "";
	const layoutSavedWillChange = layoutContainer?.style.willChange ?? "";
	const moveAlongStyle = moveAlong ? saveStyle(moveAlong) : null;
	const moveAlongStart = moveAlong?.getBoundingClientRect() ?? null;

	const cancel = () => {
		if (cancelled) return;
		cancelled = true;
		for (const card of uniqueCards) {
			card.classList.add(FILTER_CLASS);
			clearFilterClasses(card);
			card.classList.toggle(HIDDEN_CLASS, !desired.get(card));
			const saved = savedStyles.get(card);
			if (saved) restoreStyle(card, saved);
		}
		if (layoutContainer) {
			layoutContainer.style.height = layoutSavedHeight;
			layoutContainer.style.transition = layoutSavedTransition;
			layoutContainer.style.willChange = layoutSavedWillChange;
		}
		if (moveAlong && moveAlongStyle)
			restoreStyle(moveAlong, moveAlongStyle);
		resolveCancelled?.();
		resolveDone?.();
	};
	activeFilterRuns.set(group, { cancel, done: donePromise });

	const abortIfCancelled = async () => {
		if (!cancelled) return false;
		return true;
	};

	for (const card of uniqueCards) card.classList.add(FILTER_CLASS);

	const visible = uniqueCards.filter((card) => !hasHiddenState(card));
	const toHide = visible.filter((card) => !desired.get(card));
	const toKeep = visible.filter((card) => desired.get(card));
	const toShow = uniqueCards.filter(
		(card) => desired.get(card) && hasHiddenState(card),
	);
	const firstPositions = new Map<HTMLElement, DOMRect>();
	const firstStates = toKeep.map((card) => ({
		card,
		opacity: window.getComputedStyle(card).opacity || "1",
		rect: card.getBoundingClientRect(),
	}));
	for (const { card, opacity, rect } of firstStates) {
		card.style.setProperty("--effect2-keep-opacity", opacity);
		card.classList.add(KEEPING_CLASS);
		firstPositions.set(card, rect);
	}

	let layoutEndHeight: number | null = null;
	const targetPositions = new Map<HTMLElement, DOMRect>();
	let moveAlongDeltaX = 0;
	let moveAlongDeltaY = 0;

	if (toHide.length || toShow.length) {
		// Measure the complete final layout before starting Effect2. Temporary
		// display changes are restored before the browser paints.
		for (const card of uniqueCards) card.classList.add(MEASURING_CLASS);
		for (const card of toHide) card.classList.add(HIDDEN_CLASS);
		for (const card of toShow) {
			card.classList.remove(HIDDEN_CLASS);
			card.classList.add(ENTERING_CLASS);
		}
		const restoreMeasuredLayout = options.measureLayout?.();
		if (layoutContainer) layoutContainer.style.height = "auto";
		const layoutMeasureTarget =
			layoutContainer ?? uniqueCards[0]?.parentElement ?? uniqueCards[0];
		void layoutMeasureTarget?.offsetHeight;
		if (layoutContainer) {
			layoutEndHeight = layoutContainer.getBoundingClientRect().height;
		}
		for (const card of toKeep) {
			targetPositions.set(card, card.getBoundingClientRect());
		}
		if (moveAlong && moveAlongStart) {
			const target = moveAlong.getBoundingClientRect();
			moveAlongDeltaX = Math.round(target.left - moveAlongStart.left);
			moveAlongDeltaY = Math.round(target.top - moveAlongStart.top);
		}
		restoreMeasuredLayout?.();
		for (const card of toHide) card.classList.remove(HIDDEN_CLASS);
		for (const card of toShow) {
			card.classList.add(HIDDEN_CLASS);
			card.classList.remove(ENTERING_CLASS);
		}
		for (const card of uniqueCards) card.classList.remove(MEASURING_CLASS);
		if (layoutContainer && layoutStartHeight !== undefined) {
			layoutContainer.style.height = `${layoutStartHeight}px`;
		}
		void layoutMeasureTarget?.offsetHeight;
	}

	const layoutWillGrow =
		layoutEndHeight !== null &&
		layoutStartHeight !== undefined &&
		layoutEndHeight > layoutStartHeight;
	const layoutWillShrink =
		layoutEndHeight !== null &&
		layoutStartHeight !== undefined &&
		layoutEndHeight < layoutStartHeight;

	const animateGrowthInHidePhase = animateLayoutHeight && layoutWillGrow;
	if (toHide.length) {
		for (const card of toHide) card.classList.add(HIDING_CLASS);
	}
	if (
		animateGrowthInHidePhase &&
		layoutContainer &&
		layoutEndHeight !== null
	) {
		layoutContainer.style.transition =
			"height var(--effect2-duration-hide) linear";
		layoutContainer.style.willChange = "height";
		layoutContainer.style.height = `${layoutEndHeight}px`;
	}
	if (toHide.length || animateGrowthInHidePhase) {
		const hideMotionElements: HTMLElement[] = [...toHide];
		if (animateGrowthInHidePhase && layoutContainer) {
			hideMotionElements.push(layoutContainer);
		}
		await waitForCssMotion(
			hideMotionElements,
			(animation) => {
				const property = getTransitionProperty(animation);
				return property === "opacity" || property === "height";
			},
			Effect2.duration_hide,
			cancelledPromise,
		);
		if (await abortIfCancelled()) return;
	}
	if (toHide.length) {
		for (const card of toHide) {
			card.classList.remove(HIDING_CLASS);
			card.classList.add(HIDDEN_CLASS);
		}
	}

	if (layoutContainer && layoutStartHeight !== undefined) {
		// Growing containers are expanded before the move phase. Shrinking
		// containers stay at their old height until the move phase ends.
		const shouldGrow =
			layoutEndHeight !== null && layoutEndHeight > layoutStartHeight;
		layoutContainer.style.height = `${
			shouldGrow ? layoutEndHeight : layoutStartHeight
		}px`;
		void layoutContainer.offsetHeight;
		if (shouldGrow && moveAlong && moveAlongStart) {
			moveAlong.style.transition = "none";
			moveAlong.style.willChange = "transform";
			moveAlong.style.transform = `translate3d(${-moveAlongDeltaX}px, ${-moveAlongDeltaY}px, 0)`;
		}
	}

	options.afterHide?.(toHide);
	if (await abortIfCancelled()) return;

	await nextFrame();
	if (await abortIfCancelled()) return;

	const movingCards = new Map<HTMLElement, { x: number; y: number }>();
	const currentPositions = toKeep.map((card) => ({
		card,
		rect: card.getBoundingClientRect(),
	}));
	for (const { card, rect: current } of currentPositions) {
		const first = firstPositions.get(card);
		if (!first) continue;
		const target = targetPositions.get(card) ?? current;
		const startX = Math.round(first.left - current.left);
		const startY = Math.round(first.top - current.top);
		const endX = Math.round(target.left - current.left);
		const endY = Math.round(target.top - current.top);
		if (!startX && !startY && !endX && !endY) continue;
		card.style.transition = "none";
		card.style.willChange = "transform";
		card.style.transform = `translate3d(${startX}px, ${startY}px, 0)`;
		movingCards.set(card, { x: endX, y: endY });
	}

	const moveAlongChanges = moveAlongDeltaX !== 0 || moveAlongDeltaY !== 0;
	const moveAlongStartX = layoutWillGrow ? -moveAlongDeltaX : 0;
	const moveAlongStartY = layoutWillGrow ? -moveAlongDeltaY : 0;
	const moveAlongEndX = layoutWillGrow ? 0 : moveAlongDeltaX;
	const moveAlongEndY = layoutWillGrow ? 0 : moveAlongDeltaY;
	if (moveAlongChanges && moveAlong) {
		moveAlong.style.transition = "none";
		moveAlong.style.willChange = "transform";
		moveAlong.style.transform = `translate3d(${moveAlongStartX}px, ${moveAlongStartY}px, 0)`;
	}

	if ((movingCards.size || moveAlongChanges) && Effect2.duration_move > 0) {
		await nextFrame();
		if (await abortIfCancelled()) return;
		const moveMotionElements = Array.from(movingCards.keys());
		for (const [card, target] of movingCards) {
			card.classList.add(MOVING_CLASS);
			card.style.transition = "";
			card.style.transform = `translate3d(${target.x}px, ${target.y}px, 0)`;
		}
		if (moveAlongChanges && moveAlong) {
			moveAlong.style.transition =
				"transform var(--effect2-duration-move) var(--effect2-move-easing, cubic-bezier(0.4, 0, 0.2, 1))";
			moveAlong.style.transform = `translate3d(${moveAlongEndX}px, ${moveAlongEndY}px, 0)`;
			moveMotionElements.push(moveAlong);
		}
		await waitForCssMotion(
			moveMotionElements,
			(animation) => getTransitionProperty(animation) === "transform",
			Effect2.duration_move,
			cancelledPromise,
		);
		if (await abortIfCancelled()) return;
	}

	const deferAnimatedLayoutToReveal =
		animateLayoutHeight &&
		(layoutWillShrink || layoutWillGrow) &&
		layoutContainer !== null;
	if (
		layoutContainer &&
		layoutEndHeight !== null &&
		!deferAnimatedLayoutToReveal
	) {
		layoutContainer.style.height = `${layoutEndHeight}px`;
		void layoutContainer.offsetHeight;
		layoutContainer.style.height = layoutSavedHeight;
		layoutContainer.style.transition = layoutSavedTransition;
		layoutContainer.style.willChange = layoutSavedWillChange;
		void layoutContainer.offsetHeight;
	}
	if (moveAlong && moveAlongStyle && !toShow.length) {
		restoreStyle(moveAlong, moveAlongStyle);
	}

	if (
		deferAnimatedLayoutToReveal &&
		layoutWillShrink &&
		layoutContainer &&
		layoutEndHeight !== null
	) {
		layoutContainer.style.transition =
			"height var(--effect2-duration-show) linear";
		layoutContainer.style.willChange = "height";
		layoutContainer.style.height = `${layoutEndHeight}px`;
	}

	if (toShow.length) {
		// The move phase keeps matching cards hidden, so retained cards are
		// translated onto their measured final coordinates. Activate the final
		// layout and retire those translations in the same task before revealing:
		// otherwise the newly displayed cards shift the layout a second time
		// while the old transform is still active, causing an overshoot and a
		// snap back when the transform is cleaned up after the fade.
		for (const card of toKeep) {
			card.classList.remove(MOVING_CLASS);
			card.style.transition = "none";
			card.style.transform = "";
		}
		if (moveAlong) {
			moveAlong.style.transition = "none";
			moveAlong.style.transform = "";
		}
		for (const card of toShow) {
			card.style.transition = "none";
			card.style.opacity = "0";
			card.classList.remove(HIDDEN_CLASS);
			card.classList.add(ENTERING_CLASS);
		}
		void toShow[0].offsetHeight;
		await nextFrame();
		if (await abortIfCancelled()) return;
		for (const card of toShow) {
			card.classList.remove(ENTERING_CLASS);
			card.classList.add(REVEALING_CLASS);
			card.style.transition = "none";
			card.style.opacity = "";
		}
		// Force one shared style calculation for the whole reveal batch. CSS
		// animations do not start until this flush, so even a large card set
		// begins fading on the same frame instead of after the synchronous
		// setup for earlier cards has already consumed most of the duration.
		void toShow[0].offsetHeight;
		if (Effect2.duration_show <= 0) {
			for (const card of toShow) card.style.opacity = "";
		}
		const revealMotionElements: HTMLElement[] = [...toShow];
		if (
			deferAnimatedLayoutToReveal &&
			layoutWillShrink &&
			layoutContainer
		) {
			revealMotionElements.push(layoutContainer);
		}
		await waitForCssMotion(
			revealMotionElements,
			(animation) =>
				getAnimationName(animation) === "Effect2_show" ||
				getTransitionProperty(animation) === "height",
			Effect2.duration_show,
			cancelledPromise,
		);
		if (await abortIfCancelled()) return;
	} else if (deferAnimatedLayoutToReveal) {
		if (layoutContainer) {
			await waitForCssMotion(
				[layoutContainer],
				(animation) => getTransitionProperty(animation) === "height",
				Effect2.duration_show,
				cancelledPromise,
			);
		}
		if (await abortIfCancelled()) return;
	}

	if (
		deferAnimatedLayoutToReveal &&
		layoutContainer &&
		layoutEndHeight !== null
	) {
		layoutContainer.style.height = `${layoutEndHeight}px`;
		void layoutContainer.offsetHeight;
		layoutContainer.style.height = layoutSavedHeight;
		layoutContainer.style.transition = layoutSavedTransition;
		layoutContainer.style.willChange = layoutSavedWillChange;
	}
	options.afterReveal?.(toShow);
	for (const card of uniqueCards) {
		clearFilterClasses(card);
		if (desired.get(card)) card.classList.remove(HIDDEN_CLASS);
	}
	for (const [card, saved] of savedStyles) restoreStyle(card, saved);
	if (layoutContainer) {
		layoutContainer.style.height = layoutSavedHeight;
		layoutContainer.style.transition = layoutSavedTransition;
		layoutContainer.style.willChange = layoutSavedWillChange;
	}
	if (moveAlong && moveAlongStyle) restoreStyle(moveAlong, moveAlongStyle);
	if (activeFilterRuns.get(group)?.cancel === cancel) {
		activeFilterRuns.delete(group);
	}
	resolveDone?.();
}

let navigationHidePromise: Promise<void> | null = null;

/**
 * Runs Effect1_hide before Swup swaps the content. The returned delay is also
 * used by the page transition controller, so the outgoing cards can finish
 * their motion before the old DOM is detached.
 */
export function hideCardsForNavigation(): Promise<void> {
	if (typeof window === "undefined") return Promise.resolve();
	if (navigationHidePromise) return navigationHidePromise;

	const cards = Array.from(
		document.querySelectorAll<HTMLElement>("[data-effect1-card]"),
	);
	if (!cards.length || Effect1.duration_hide <= 0) return Promise.resolve();

	for (const card of cards) {
		card.style.setProperty("--effect1-hide-delay", "0ms");
		card.classList.add("effect1-hiding");
	}

	navigationHidePromise = wait(Effect1.duration_hide).then(() => {
		navigationHidePromise = null;
	});
	return navigationHidePromise;
}

export function restoreCardsAfterNavigation(): void {
	if (typeof document === "undefined") return;
	const cards = document.querySelectorAll<HTMLElement>(
		"[data-effect1-card].effect1-hiding",
	);
	for (const card of cards) card.classList.remove("effect1-hiding");
	navigationHidePromise = null;
}

export function replayEffect1Show(scope: ParentNode = document): void {
	if (typeof window === "undefined") return;
	const cards = Array.from(
		scope.querySelectorAll<HTMLElement>("[data-effect1-card]"),
	);
	if (!cards.length) return;

	for (const card of cards) {
		card.classList.remove(
			FILTER_CLASS,
			HIDDEN_CLASS,
			HIDING_CLASS,
			ENTERING_CLASS,
			REVEALING_CLASS,
			MOVING_CLASS,
		);
		card.classList.add("effect1-reset");
	}
	void (cards[0] as HTMLElement).offsetWidth;
	window.requestAnimationFrame(() => {
		window.requestAnimationFrame(() => {
			for (const card of cards) card.classList.remove("effect1-reset");
		});
	});
}

export function countVisibilityChanges(
	cards: Iterable<HTMLElement>,
	shouldShow: VisibilityPredicate,
): number {
	let changed = 0;
	for (const card of new Set(cards)) {
		if (hasHiddenState(card) === !shouldShow(card)) changed += 1;
	}
	return changed;
}

export function setCardFilterVisibility(
	cards: Iterable<HTMLElement>,
	shouldShow: VisibilityPredicate,
): void {
	for (const card of new Set(cards)) {
		clearFilterClasses(card);
		card.classList.remove("effect1-hiding", "effect1-reset");
		card.classList.toggle(HIDDEN_CLASS, !shouldShow(card));
	}
}

export async function hideCardFilterHost(
	host: HTMLElement,
	deadline: number,
): Promise<void> {
	if (!host.isConnected) return;
	host.classList.remove("effect1-reset");
	host.classList.add("effect1-hiding-allow-interaction");
	host.classList.add("effect1-hiding");
	void host.offsetHeight;
	await waitForEffect1Phase(host, "Effect1_hide", deadline);
}

export async function showCardFilterHost(
	host: HTMLElement,
	deadline: number,
): Promise<void> {
	if (!host.isConnected) return;
	host.classList.remove("effect1-hiding", "effect1-hiding-allow-interaction");
	host.classList.add("effect1-reset");
	void host.offsetHeight;
	await Promise.race([
		nextFrame(),
		wait(Math.max(0, deadline - performance.now())),
	]);
	await Promise.race([
		nextFrame(),
		wait(Math.max(0, deadline - performance.now())),
	]);
	if (!host.isConnected) return;
	host.classList.remove("effect1-reset");
	void host.offsetHeight;
	await waitForEffect1Phase(host, "Effect1_show", deadline);
}

function getFilterHeightSpacer(): HTMLElement | null {
	return document.querySelector<HTMLElement>(
		"[data-card-filter-height-spacer]",
	);
}

function ensureFilterHeightSpacer(host: HTMLElement): HTMLElement | null {
	const anchor = host.parentElement;
	if (!anchor?.parentElement) return null;
	const existing = getFilterHeightSpacer();
	if (existing) return existing;

	const spacer = document.createElement("div");
	spacer.setAttribute("data-card-filter-height-spacer", "");
	spacer.setAttribute("aria-hidden", "true");
	spacer.style.cssText =
		"display:block;width:100%;height:0;flex:none;pointer-events:none;background:transparent;";
	anchor.insertAdjacentElement("afterend", spacer);
	return spacer;
}

function isNearPageBottom(): boolean {
	const scrollHeight = Math.max(
		document.documentElement.scrollHeight,
		document.body.scrollHeight,
	);
	return window.scrollY + window.innerHeight >= scrollHeight - 2;
}

async function waitForFilterLayout(
	container: HTMLElement,
	deadline: number,
): Promise<void> {
	void container.getBoundingClientRect();
	await Promise.race([
		nextFrame(),
		wait(Math.max(0, deadline - performance.now())),
	]);
	if (!container.isConnected) return;

	const firstHeight = container.getBoundingClientRect().height;
	await Promise.race([
		nextFrame(),
		wait(Math.max(0, deadline - performance.now())),
	]);
	if (!container.isConnected) return;

	const secondHeight = container.getBoundingClientRect().height;
	if (Math.abs(firstHeight - secondHeight) <= 1) return;

	await Promise.race([
		nextFrame(),
		wait(Math.max(0, deadline - performance.now())),
	]);
}

export async function runEffect1CardFilter(options: {
	host: HTMLElement;
	layoutContainer: HTMLElement;
	deadline: number;
	duringHidden: () => void | Promise<void>;
}): Promise<void> {
	if (
		typeof window === "undefined" ||
		!options.host.isConnected ||
		!options.layoutContainer.isConnected
	) {
		return;
	}

	const existingSpacer = getFilterHeightSpacer();
	const previousReservedHeight =
		options.host.getBoundingClientRect().height +
		(existingSpacer?.getBoundingClientRect().height ?? 0);
	const shouldReserveHeight = isNearPageBottom() || Boolean(existingSpacer);
	let revealed = false;

	try {
		await hideCardFilterHost(options.host, options.deadline);
		if (!options.host.isConnected) return;

		await options.duringHidden();
		if (!options.host.isConnected) return;

		await waitForFilterLayout(options.layoutContainer, options.deadline);
		if (!options.host.isConnected) return;

		const targetHeight = options.host.getBoundingClientRect().height;
		const spacer = shouldReserveHeight
			? ensureFilterHeightSpacer(options.host)
			: getFilterHeightSpacer();
		if (spacer) {
			spacer.style.height = `${Math.max(
				0,
				previousReservedHeight - targetHeight,
			)}px`;
		}

		await showCardFilterHost(options.host, options.deadline);
		revealed = true;
	} finally {
		if (!revealed && options.host.isConnected) {
			options.host.classList.remove(
				"effect1-hiding",
				"effect1-hiding-allow-interaction",
				"effect1-reset",
			);
			void options.host.offsetHeight;
			for (const animation of getEffect1Animations(
				options.host,
				"Effect1_show",
			)) {
				try {
					animation.finish();
				} catch {
					/* Recovery is best-effort after cancellation. */
				}
			}
		}
	}
}

export function clearCardFilterRuntime(): void {
	if (typeof document === "undefined") return;
	for (const host of activeHeightHosts) {
		activeHeightRuns.get(host)?.cancel();
	}
	activeHeightHosts.clear();
	for (const spacer of document.querySelectorAll<HTMLElement>(
		"[data-card-filter-height-spacer]",
	)) {
		spacer.remove();
	}
	for (const host of document.querySelectorAll<HTMLElement>(
		"[data-effect1-card].effect1-hiding, [data-effect1-card].effect1-reset",
	)) {
		host.classList.remove(
			"effect1-hiding",
			"effect1-hiding-allow-interaction",
			"effect1-reset",
		);
	}
}

export async function animateFilterHostHeight(
	host: HTMLElement,
	mutate: () => void,
	duration: number,
	easing: string,
): Promise<void> {
	activeHeightRuns.get(host)?.cancel();
	const savedHeight = host.style.height;
	const savedTransition = host.style.transition;
	const savedWillChange = host.style.willChange;
	const startHeight = host.getBoundingClientRect().height;
	let finished = false;
	let resolveCancelled: (() => void) | null = null;
	const cancelledPromise = new Promise<void>((resolve) => {
		resolveCancelled = resolve;
	});

	const cleanup = () => {
		host.style.height = savedHeight;
		host.style.transition = savedTransition;
		host.style.willChange = savedWillChange;
	};
	const cancel = () => {
		if (finished) return;
		finished = true;
		cleanup();
		resolveCancelled?.();
	};
	activeHeightRuns.set(host, { cancel });
	activeHeightHosts.add(host);

	try {
		host.style.transition = "none";
		host.style.height = `${startHeight}px`;
		void host.offsetHeight;
		mutate();
		if (!host.isConnected || duration <= 0) return;

		host.style.height = "auto";
		void host.offsetHeight;
		const targetHeight = host.getBoundingClientRect().height;
		host.style.height = `${startHeight}px`;
		void host.offsetHeight;

		if (Math.abs(targetHeight - startHeight) <= 0.5) return;
		host.style.willChange = "height";
		host.style.transition = `height ${duration}ms ${easing}`;
		host.style.height = `${targetHeight}px`;
		await waitForCssMotion(
			[host],
			(animation) => getTransitionProperty(animation) === "height",
			duration,
			cancelledPromise,
		);
	} finally {
		if (!finished) {
			finished = true;
			cleanup();
		}
		if (activeHeightRuns.get(host)?.cancel === cancel) {
			activeHeightRuns.delete(host);
			activeHeightHosts.delete(host);
		}
	}
}

export function isCardFilterAnimating(group: Element): boolean {
	return activeFilterRuns.has(group);
}

export async function waitForCardFilterIdle(group: Element): Promise<void> {
	while (activeFilterRuns.has(group)) {
		const run = activeFilterRuns.get(group);
		if (!run) return;
		await run.done;
	}
}

export function installCardFilterApi(): void {
	if (typeof window === "undefined") return;
	syncEffect2CssTiming();
	window.CardFilter = {
		applyGroup: applyCardFilter,
		apply: (
			card: HTMLElement,
			visible: boolean,
			options: Omit<FilterOptions, "group"> = {},
		) =>
			applyCardFilter([card], () => visible, {
				...options,
				group: card.parentElement,
			}),
		isHidden,
		countChanges: countVisibilityChanges,
		setVisibility: setCardFilterVisibility,
		hideEffect1: hideCardFilterHost,
		showEffect1: showCardFilterHost,
		runEffect1: runEffect1CardFilter,
		clearRuntime: clearCardFilterRuntime,
		animateHeight: animateFilterHostHeight,
		config: () => ({
			enable: true,
			duration: Effect2.duration_hide,
			hide: Effect2.duration_hide,
			move: Effect2.duration_move,
			show: Effect2.duration_show,
			edge: Effect2.edge,
			maxWaitingTime: Effect2.max_waitting_time,
			isAnimating: isCardFilterAnimating,
			waitForIdle: waitForCardFilterIdle,
		}),
	};

	window.addEventListener("pagehide", clearCardFilterRuntime);
	document.addEventListener("swup:page:view", clearCardFilterRuntime);
	document.addEventListener("astro:before-swap", clearCardFilterRuntime);
}

installCardFilterApi();
