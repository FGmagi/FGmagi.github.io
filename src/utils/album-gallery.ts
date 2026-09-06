/**
 * 相册详情页「三段式渲染编排」（客户端，仅浏览器）。
 *
 * 流程：
 *   S0 尺寸期 —— 需要尺寸但 SSR 未知的照片先探测/读缓存；期间整卡空白 + 居中旋转圆圈，
 *                绝不渲染未排版的占位图。
 *   S1 占位期 —— 尺寸齐后每张图显示「已排版、未加载」的空白占位 + 每图旋转圆圈。
 *   S2 加载期 —— 视口优先（IntersectionObserver rootMargin≈600px）、并发≤6 队列逐个加载；
 *                滚动即时补载；img load/decode 后比对 naturalWidth/Height 与占位比，
 *                差 >1% 才更新 figure aspect-ratio 并写 photo-cache（正常情况零重排）；
 *                onerror → 占位。grid 模式只做 lazy/loaded/error，不动盒子比例。
 *
 * 同一模块顶层只注册一次，同时响应：
 *   - 首载（DOMContentLoaded）
 *   - swup content:replace（中止上一页在途请求 + 武装页面就绪标记）
 *   - astro:page-load / swup:page:view（新 DOM 就绪后真正执行初始化；重复信号去重）
 * 修复 SPA 跳入相册页时页面级模块脚本不重跑、gallery 不初始化的缺陷。
 *
 * 绝不全量下载：尺寸探测走 Range 头字节（photo-size），失败即默认占位。
 * 缓存：读/写 photo-cache（localStorage 命名空间 mzAlbumPhoto:），绝不回写构建产物。
 */

import { getSize, setSize } from "./photo-cache.js";
import { fetchHeaderSize } from "./photo-size.js";

/** 未知尺寸项的默认宽高比占位（探测失败时先用；加载后校正成真实比例） */
const DEFAULT_ASPECT_W = 3;
const DEFAULT_ASPECT_H = 2;

const MAX_CONCURRENT = 6; // 图片内容并发加载上限
const VIEWPORT_MARGIN = "600px 0px"; // 视口预载边距
const RATIO_TOLERANCE = 0.01; // >1% 差异才校正

interface GalleryItem {
	figure: HTMLElement;
	img: HTMLImageElement | null;
	src: string | null;
	key: string | null;
}

function isElement(node: unknown): node is Element {
	return node instanceof Element;
}

function queryFigures(container: Element): HTMLElement[] {
	const figures: HTMLElement[] = [];
	container.querySelectorAll(":scope > figure.photo-item").forEach((f) => {
		if (isElement(f)) figures.push(f as HTMLElement);
	});
	return figures;
}

function toItem(figure: HTMLElement): GalleryItem {
	const img = figure.querySelector<HTMLImageElement>("img.photo-image");
	return {
		figure,
		img,
		src:
			img?.getAttribute("data-src") ||
			figure.getAttribute("data-src") ||
			null,
		key:
			figure.getAttribute("data-key") ||
			img?.getAttribute("data-key") ||
			null,
	};
}

/** 从 data-dim="w,h" 读取期望尺寸。 */
function readDimAttr(figure: HTMLElement): { w: number; h: number } | null {
	const dim = figure.getAttribute("data-dim");
	if (!dim) return null;
	const m = /^\s*(\d+)\s*[,xX]\s*(\d+)\s*$/.exec(dim);
	if (!m) return null;
	const w = Number(m[1]);
	const h = Number(m[2]);
	return w > 0 && h > 0 ? { w, h } : null;
}

/** 应用一个尺寸到 figure：内联 aspect-ratio + data-dim。 */
function applyDim(
	figure: HTMLElement,
	w: number,
	h: number,
	fromCache = false,
): void {
	if (!(w > 0 && h > 0)) return;
	figure.style.aspectRatio = `${w} / ${h}`;
	if (fromCache || !figure.getAttribute("data-dim")) {
		figure.setAttribute("data-dim", `${w},${h}`);
	}
}

/** 按需创建一个居中旋转圆圈元素。 */
function createSpinner(sizePx = 28): HTMLSpanElement {
	const s = document.createElement("span");
	s.className = "photo-spinner";
	s.setAttribute("aria-hidden", "true");
	if (sizePx !== 28) {
		s.style.width = `${sizePx}px`;
		s.style.height = `${sizePx}px`;
	}
	return s;
}

/**
 * 单一容器编排。容器只初始化一次（WeakSet 防重）。
 */
const initializedContainers = new WeakSet<Element>();
let activeAbort: AbortController | null = null;
let initScheduled = false;

function newAbort(): AbortController {
	if (activeAbort) activeAbort.abort();
	activeAbort = new AbortController();
	return activeAbort;
}

export async function initAlbumGallery(
	scope?: ParentNode | null,
): Promise<void> {
	if (typeof document === "undefined") return;
	const root: ParentNode = scope ?? document;
	if (!root) return;
	const containers = root.querySelectorAll(".photo-gallery");
	containers.forEach((container) => {
		if (initializedContainers.has(container)) return;
		if (!container.isConnected) return;
		initializedContainers.add(container);
		// 不阻塞事件循环：编排内部自有异步流程
		void runGallery(container as HTMLElement);
	});
}

async function runGallery(container: HTMLElement): Promise<void> {
	const layout = container.getAttribute("data-layout") || "grid";
	const figures = queryFigures(container);
	if (figures.length === 0) return;

	const signal = newAbort().signal;

	// ---------- S0 / S1：尺寸期 ----------
	if (layout === "masonry") {
		const ok = await ensureSizesReady(container, figures, signal);
		if (!ok) return; // 中止（页面已离开）
	} else {
		// grid：CSS 1:1 裁剪，盒子比例由 CSS 决定，无需尺寸
		markSizingDone(container);
	}

	// ---------- S2：加载期 ----------
	startLazyLoading(figures, layout, signal);
}

/**
 * masonry 尺寸期：
 * 1. 用 localStorage 缓存补齐已知尺寸；
 * 2. 仍未知的 → 整卡进入 sizing 态（空白 + 居中圆圈），Range 探测补齐；
 * 3. 探测失败/本地未知 → 默认宽高比占位（加载后校正）。
 * 返回 false 表示运行被中止（页面已切换），调用方应放弃。
 */
async function ensureSizesReady(
	container: HTMLElement,
	figures: HTMLElement[],
	signal: AbortSignal,
): Promise<boolean> {
	// 第一步：读缓存
	for (const figure of figures) {
		const dim = readDimAttr(figure); // SSR 已知
		if (dim) continue;
		const cached = getSize(figure.getAttribute("data-key") || "");
		if (cached) applyDim(figure, cached.w, cached.h, true);
	}

	// 第二步：仍未知的项
	let unknown = figures.filter((f) => !readDimAttr(f));
	if (unknown.length === 0) {
		markSizingDone(container);
		return true;
	}

	// 进入 sizing 态：整卡空白 + 居中圆圈（CSS .gallery-sizing 隐藏所有 figure）
	container.classList.add("gallery-sizing");
	const indicator = document.createElement("div");
	indicator.className = "gallery-sizing-indicator";
	indicator.setAttribute("aria-hidden", "true");
	const bigSpinner = createSpinner(36);
	indicator.appendChild(bigSpinner);
	container.appendChild(indicator);

	try {
		// 需要探测的：外链 http(s) 且无缓存（本地路径构建期必已知，直接默认占位）
		const probeable = unknown.filter((f) => {
			const src =
				f.getAttribute("data-src") ||
				f.querySelector("img")?.getAttribute("data-src") ||
				"";
			return /^https?:\/\//i.test(src);
		});
		await probeSizes(probeable, signal, 4);

		// 第三步：仍未知 → 默认宽高比占位
		for (const figure of figures) {
			if (readDimAttr(figure)) continue;
			figure.classList.add("photo-dim-fallback");
			applyDim(figure, DEFAULT_ASPECT_W, DEFAULT_ASPECT_H);
		}
	} finally {
		if (signal.aborted) return false;
		indicator.remove();
		container.classList.remove("gallery-sizing");
	}
	markSizingDone(container);
	return true;
}

function markSizingDone(container: HTMLElement): void {
	container.classList.add("gallery-ready");
}

/** 并发受限的尺寸探测（只读头部字节，成功后写缓存）。 */
async function probeSizes(
	figures: HTMLElement[],
	signal: AbortSignal,
	limit: number,
): Promise<void> {
	let cursor = 0;
	const workers = Array.from(
		{ length: Math.min(limit, figures.length) },
		async () => {
			for (;;) {
				if (signal.aborted) return;
				const idx = cursor++;
				if (idx >= figures.length) return;
				const figure = figures[idx];
				const key = figure.getAttribute("data-key");
				const src =
					figure.getAttribute("data-src") ||
					figure.querySelector("img")?.getAttribute("data-src") ||
					"";
				const dim = await fetchHeaderSize(src, { signal });
				if (signal.aborted || !figure.isConnected) return;
				if (dim) {
					applyDim(figure, dim.w, dim.h, true);
					if (key) setSize(key, dim.w, dim.h);
				}
			}
		},
	);
	await Promise.all(workers);
}

function startLazyLoading(
	figures: HTMLElement[],
	layout: string,
	signal: AbortSignal,
): void {
	const items: GalleryItem[] = figures.map(toItem);
	const queue: GalleryItem[] = [];
	const inFlight = new Set<GalleryItem>();

	const pump = () => {
		while (inFlight.size < MAX_CONCURRENT && queue.length > 0) {
			const item = queue.shift();
			if (!item || signal.aborted) return;
			inFlight.add(item);
			void loadItem(item, layout, () => {
				inFlight.delete(item);
				pump();
			});
		}
	};

	const enqueue = (item: GalleryItem) => {
		if (!item.img) return;
		if (
			item.figure.classList.contains("photo-loaded") ||
			item.figure.classList.contains("photo-error")
		)
			return;
		if (item.img.getAttribute("src")) return; // 已开始加载
		queue.push(item);
		pump();
	};

	if (typeof IntersectionObserver === "undefined") {
		// 降级：全部进队，仍受并发上限约束
		items.forEach(enqueue);
		return;
	}

	const io = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;
				io.unobserve(entry.target);
				const idx = items.findIndex((it) => it.figure === entry.target);
				if (idx >= 0) enqueue(items[idx]);
			}
		},
		{ rootMargin: VIEWPORT_MARGIN },
	);
	items.forEach((item) => io.observe(item.figure));
}

async function loadItem(
	item: GalleryItem,
	layout: string,
	settle: () => void,
): Promise<void> {
	const { figure, img, src } = item;
	if (!img || !src) {
		markError(figure);
		settle();
		return;
	}
	let finished = false;
	const done = () => {
		if (finished) return;
		finished = true;
		settle();
	};
	const onLoad = () => {
		afterLoaded(item, layout);
		done();
	};
	const onError = () => {
		markError(figure);
		done();
	};
	img.addEventListener("load", onLoad, { once: true });
	img.addEventListener("error", onError, { once: true });
	img.src = src;
	if (img.complete && img.naturalWidth > 0) {
		// 命中浏览器缓存，load 可能已不触发
		img.removeEventListener("load", onLoad);
		img.removeEventListener("error", onError);
		afterLoaded(item, layout);
		done();
	}
}

/** 加载完成：显示图片 + natural 尺寸比对校正。 */
function afterLoaded(item: GalleryItem, layout: string): void {
	const { figure, img, key } = item;
	figure.classList.add("photo-loaded");
	figure.classList.remove("photo-dim-fallback");
	const nw = img?.naturalWidth ?? 0;
	const nh = img?.naturalHeight ?? 0;
	if (layout !== "masonry") return;
	if (!(nw > 0 && nh > 0)) return;

	const expected = readDimAttr(figure);
	if (expected) {
		const expectedRatio = expected.w / expected.h;
		const naturalRatio = nw / nh;
		const diff = Math.abs(expectedRatio - naturalRatio) / expectedRatio;
		if (diff > RATIO_TOLERANCE) {
			// 加载后校正：更新盒子 + 写尺寸缓存
			applyDim(figure, nw, nh);
			if (key) setSize(key, nw, nh);
		}
	} else {
		applyDim(figure, nw, nh);
		if (key) setSize(key, nw, nh);
	}
}

function markError(figure: HTMLElement): void {
	figure.classList.add("photo-error");
	figure.classList.remove("photo-dim-fallback");
}

// ===========================================================================
// 顶层注册（一次）：响应首载 + swup 生命周期
// ===========================================================================

function tryInitAll(): void {
	if (typeof document === "undefined") return;
	void initAlbumGallery(document);
}

/**
 * 一次 swup 访问 = content:replace →（可能多个 page:view 类信号：swup:page:view 与
 * astro:page-load 都挂在同一 hook 上）。用 armed 标志保证：
 *  - 只有 content:replace 之后到达的第一个 page:view 信号才执行中止+初始化；
 *  - 后续重复信号被忽略，避免 abort→restart 打乱尺寸探测。
 */
let pageReadyArmed = false;

function onPageReplaced(): void {
	// 只中止旧内容在途请求；新内容初始化由随后的 page:view 信号完成
	if (activeAbort) activeAbort.abort();
	pageReadyArmed = true;
}

function onNewPageReady(): void {
	if (!pageReadyArmed) return;
	pageReadyArmed = false;
	newAbort();
	tryInitAll();
}

function installSwupHooks(): void {
	if (initScheduled) return;
	initScheduled = true;
	const swup = (window as any).swup;
	if (swup && swup.hooks && typeof swup.hooks.on === "function") {
		swup.hooks.on("content:replace", onPageReplaced);
		return;
	}
	document.addEventListener("swup:enable", () => {
		installSwupHooks();
	});
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
	// 1) swup 钩子（尽早、含初次 enable）
	installSwupHooks();

	// 2) 首载
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", () => {
			tryInitAll();
			// 整页浏览器跳转离开时中止在途请求
			window.addEventListener("pagehide", () => {
				if (activeAbort) activeAbort.abort();
			});
		});
	} else {
		tryInitAll();
		window.addEventListener("pagehide", () => {
			if (activeAbort) activeAbort.abort();
		});
	}

	// 3) SPA 兜底：@swup/astro 在 page:view 派发 astro:page-load，swup 内核派发 swup:page:view
	document.addEventListener("astro:page-load", onNewPageReady);
	document.addEventListener("swup:page:view", onNewPageReady);
}
