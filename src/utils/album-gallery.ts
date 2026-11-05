import { getSize, setSize } from "./photo-cache";
import { probePhotoSizes } from "./photo-probe-client";
import { mountMasonryGrid } from "./photo-masonry-grid";

const initialized = new WeakSet<Element>();
const observed = new WeakSet<Element>();
const VIEWPORT_MARGIN = "600px 0px";
const PROBE_DEADLINE_MS = 6000;
const PROBE_TIMEOUT_MS = 8000;
const RATIO_TOLERANCE = 0.01;

type GalleryItem = {
	figure: HTMLElement;
	image: HTMLImageElement;
	key: string;
	original: string;
	thumbnail: string;
};

let activeAbort: AbortController | null = null;

function itemsIn(container: HTMLElement): GalleryItem[] {
	return Array.from(
		container.querySelectorAll<HTMLElement>(":scope > .photo-item"),
	)
		.map((figure) => {
			const image = figure.querySelector<HTMLImageElement>("img.photo-image");
			if (!image) return null;
			const key = figure.dataset.key || image.dataset.key || "";
			const original =
				image.dataset.src ||
				figure.querySelector<HTMLAnchorElement>("a[data-src]")?.dataset.src ||
				"";
			const thumbnail = image.dataset.thumb || image.dataset.src || "";
			if (!key || !thumbnail) return null;
			return { figure, image, key, original, thumbnail };
		})
		.filter((item): item is GalleryItem => item !== null);
}
function readDimension(item: GalleryItem): { w: number; h: number } | null {
	const raw = item.figure.dataset.dim;
	const matched = raw?.match(/^\s*(\d+)\s*[,xX]\s*(\d+)\s*$/);
	if (!matched) return null;
	const w = Number(matched[1]);
	const h = Number(matched[2]);
	return w > 0 && h > 0 ? { w, h } : null;
}

function applyDimension(item: GalleryItem, w: number, h: number): void {
	if (!(w > 0 && h > 0)) return;
	item.figure.style.aspectRatio = `${w} / ${h}`;
	item.figure.dataset.dim = `${w},${h}`;
	item.figure.classList.remove("photo-dim-unknown", "photo-dim-fallback");
	item.figure.classList.add("photo-dim-known");
	item.image.width = w;
	item.image.height = h;
}

function applyCachedDimensions(items: GalleryItem[]): void {
	for (const item of items) {
		if (readDimension(item)) continue;
		const cached = getSize(item.key);
		if (cached) applyDimension(item, cached.w, cached.h);
	}
}

function finishLoaded(item: GalleryItem, relayout?: () => void): void {
	item.figure.classList.add("photo-loaded");
	item.figure.classList.remove("photo-error");
	item.image.dataset.state = "loaded";
	const image = item.image;
	if (image.naturalWidth <= 0 || image.naturalHeight <= 0) return;
	const expected = readDimension(item);
	const ratio = image.naturalWidth / image.naturalHeight;
	const differs =
		!expected ||
		Math.abs(expected.w / expected.h - ratio) / ratio > RATIO_TOLERANCE;
	if (!differs) return;
	applyDimension(item, image.naturalWidth, image.naturalHeight);
	setSize(item.key, image.naturalWidth, image.naturalHeight);
	relayout?.();
}

function startLoading(item: GalleryItem, relayout?: () => void): void {
	if (observed.has(item.figure)) return;
	observed.add(item.figure);
	if (item.image.getAttribute("src")) return;

	const onLoad = () => finishLoaded(item, relayout);
	const onError = () => {
		item.figure.classList.add("photo-error");
		item.image.dataset.state = "error";
		window.dispatchEvent(
			new CustomEvent("image:error", {
				detail: { src: item.original || item.thumbnail, key: item.key },
			}),
		);
	};
	item.image.addEventListener("load", onLoad, { once: true });
	item.image.addEventListener("error", onError, { once: true });
	item.image.dataset.state = "loading";
	if (item.image.dataset.srcset) item.image.srcset = item.image.dataset.srcset;
	if (item.image.dataset.sizes) item.image.sizes = item.image.dataset.sizes;
	item.image.src = item.thumbnail;
	if (item.image.complete && item.image.naturalWidth > 0) onLoad();
}

function probeUnknownDimensions(
	items: GalleryItem[],
	signal: AbortSignal,
	relayout?: () => void,
): void {
	const jobs = items
		.filter(
			(item) =>
				!readDimension(item) && /^https?:\/\//i.test(item.original),
		)
		.map((item) => ({ key: item.key, src: item.original }));
	if (!jobs.length) return;
	const pending = new Map<string, { w: number; h: number }>();
	let scheduled = false;
	const flush = () => {
		scheduled = false;
		if (!pending.size || signal.aborted) return;
		const byKey = new Map(items.map((item) => [item.key, item]));
		for (const [key, dim] of pending) {
			const item = byKey.get(key);
			if (!item || !item.figure.isConnected) continue;
			applyDimension(item, dim.w, dim.h);
			setSize(key, dim.w, dim.h);
		}
		pending.clear();
		relayout?.();
	};
	void probePhotoSizes(jobs, {
		signal,
		concurrency: 3,
		timeoutMs: PROBE_TIMEOUT_MS,
		deadlineMs: PROBE_DEADLINE_MS,
		onResult: (key, w, h) => {
			pending.set(key, { w, h });
			if (scheduled) return;
			scheduled = true;
			requestAnimationFrame(flush);
		},
	});
}

function observeItems(
	items: GalleryItem[],
	signal: AbortSignal,
	relayout?: () => void,
): void {
	if (typeof IntersectionObserver === "undefined") {
		items.forEach((item) => startLoading(item, relayout));
		return;
	}
	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;
				const item = items.find(
					(candidate) => candidate.figure === entry.target,
				);
				if (!item) continue;
				observer.unobserve(entry.target);
				if (!signal.aborted) startLoading(item, relayout);
			}
		},
		{ rootMargin: VIEWPORT_MARGIN },
	);
	items.forEach((item) => observer.observe(item.figure));
	signal.addEventListener("abort", () => observer.disconnect(), {
		once: true,
	});
}

function runGallery(container: HTMLElement, signal: AbortSignal): void {
	const items = itemsIn(container);
	if (!items.length) return;
	applyCachedDimensions(items);
	const relayout =
		container.dataset.layout === "masonry"
			? mountMasonryGrid(container, signal)?.relayout
			: undefined;
	probeUnknownDimensions(items, signal, relayout);
	observeItems(items, signal, relayout);
	container.classList.add("gallery-ready");
}

export async function initAlbumGallery(
	scope: ParentNode | null = null,
): Promise<void> {
	if (typeof document === "undefined") return;
	const root = scope ?? document;
	const containers = Array.from(
		root.querySelectorAll<HTMLElement>(".photo-gallery"),
	).filter((container) => {
		if (initialized.has(container) || !container.isConnected) return false;
		initialized.add(container);
		return true;
	});
	if (!containers.length) return;
	if (activeAbort) activeAbort.abort();
	activeAbort = new AbortController();
	containers.forEach((container) =>
		runGallery(container, activeAbort!.signal),
	);
}

function cancel(): void {
	activeAbort?.abort();
	activeAbort = null;
}

let hooksInstalled = false;
function installHooks(): void {
	if (hooksInstalled) return;
	const swup = (window as any).swup;
	if (!swup?.hooks?.on) return;
	swup.hooks.on("content:replace", cancel);
	hooksInstalled = true;
}

function pageReady(): void {
	void initAlbumGallery(document);
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
	installHooks();
	document.addEventListener("swup:enable", installHooks, { once: true });
	document.addEventListener("swup:content:replace", cancel);
	document.addEventListener("astro:page-load", pageReady);
	document.addEventListener("swup:page:view", pageReady);
	window.addEventListener("pagehide", cancel);
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", pageReady, {
			once: true,
		});
	} else {
		pageReady();
	}
}
