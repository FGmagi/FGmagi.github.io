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
};

const activeFilterRuns = new WeakMap<Element, ActiveFilterRun>();
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

function isHidden(card: HTMLElement): boolean {
	return (
		card.classList.contains(HIDDEN_CLASS) ||
		card.hidden ||
		card.style.display === "none" ||
		window.getComputedStyle(card).display === "none"
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
	const savedStyles = new Map(
		uniqueCards.map((card) => [card, saveStyle(card)]),
	);
	const layoutContainer =
		options.layoutContainer?.isConnected ? options.layoutContainer : null;
	const animateLayoutHeight = options.animateLayoutHeight === true;
	const moveAlong =
		options.moveAlong?.isConnected ? options.moveAlong : null;
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
		if (moveAlong && moveAlongStyle) restoreStyle(moveAlong, moveAlongStyle);
		resolveCancelled?.();
	};
	activeFilterRuns.set(group, { cancel });

	const abortIfCancelled = async () => {
		if (!cancelled) return false;
		return true;
	};

	for (const card of uniqueCards) card.classList.add(FILTER_CLASS);

	const visible = uniqueCards.filter((card) => !isHidden(card));
	const toHide = visible.filter((card) => !desired.get(card));
	const toKeep = visible.filter((card) => desired.get(card));
	const toShow = uniqueCards.filter(
		(card) => desired.get(card) && isHidden(card),
	);
	const firstPositions = new Map<HTMLElement, DOMRect>();
	for (const card of toKeep) {
		card.style.setProperty(
			"--effect2-keep-opacity",
			window.getComputedStyle(card).opacity || "1",
		);
		card.classList.add(KEEPING_CLASS);
		firstPositions.set(card, card.getBoundingClientRect());
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
		layoutContainer.style.transition = `height ${Effect2.duration_hide}ms linear`;
		layoutContainer.style.willChange = "height";
		layoutContainer.style.height = `${layoutEndHeight}px`;
	}
	if (toHide.length || animateGrowthInHidePhase) {
		await Promise.race([wait(Effect2.duration_hide), cancelledPromise]);
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
	for (const card of toKeep) {
		const first = firstPositions.get(card);
		if (!first) continue;
		const current = card.getBoundingClientRect();
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

	if (
		(movingCards.size || moveAlongChanges) &&
		Effect2.duration_move > 0
	) {
		await nextFrame();
		if (await abortIfCancelled()) return;
		for (const [card, target] of movingCards) {
			card.classList.add(MOVING_CLASS);
			card.style.transition = "";
			card.style.transform = `translate3d(${target.x}px, ${target.y}px, 0)`;
		}
		if (moveAlongChanges && moveAlong) {
			moveAlong.style.transition = `transform ${Effect2.duration_move}ms linear`;
			moveAlong.style.transform = `translate3d(${moveAlongEndX}px, ${moveAlongEndY}px, 0)`;
		}
		await Promise.race([wait(Effect2.duration_move), cancelledPromise]);
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
	if (moveAlong && moveAlongStyle) {
		restoreStyle(moveAlong, moveAlongStyle);
	}

	if (
		deferAnimatedLayoutToReveal &&
		layoutWillShrink &&
		layoutContainer &&
		layoutEndHeight !== null
	) {
		layoutContainer.style.transition = `height ${Effect2.duration_show}ms linear`;
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
		await Promise.race([nextFrame(), cancelledPromise]);
		if (await abortIfCancelled()) return;
		await Promise.race([wait(Effect2.duration_show), cancelledPromise]);
		if (await abortIfCancelled()) return;
	} else if (deferAnimatedLayoutToReveal) {
		await Promise.race([wait(Effect2.duration_show), cancelledPromise]);
		if (await abortIfCancelled()) return;
	}

	if (deferAnimatedLayoutToReveal && layoutContainer && layoutEndHeight !== null) {
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

export function installCardFilterApi(): void {
	if (typeof window === "undefined") return;
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
		config: () => ({
			enable: true,
			duration: Effect2.duration_hide,
			hide: Effect2.duration_hide,
			move: Effect2.duration_move,
			show: Effect2.duration_show,
		}),
	};
}

installCardFilterApi();
