/**
 * 相册详情页「三段式渲染编排」（客户端，仅浏览器）。
 *
 * 流程：
 *   S0 尺寸期 —— 立即给「尺寸未知」的项一个默认宽高比占位（不再整卡空白等待），
 *                同时把 Range 尺寸探测交 Worker 异步补齐；结果按帧批量回填（只重排一次/帧）。
 *   S1 占位期 —— 每张图显示「已排版、未加载」的空白占位 + 每图旋转圆圈。
 *   S2 加载期 —— 视口优先（IntersectionObserver rootMargin≈600px）、并发≤6 队列逐个加载；
 *                整张图的下载 + 解码在 photo-bitmap Worker 内完成，主线程只 drawImage 一次；
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
 *
 * 26.09.14（外链不可达卡死修复 —— UI 线程分离）：
 *   ① 尺寸探测整体下沉到 Web Worker（photo-probe-client）：主线程只收结果，不跑请求/解析；
 *   ② 取图 + 解码整体下沉到 Web Worker（photo-bitmap）：主线程只收 ImageBitmap，不跑解码；
 *   ③ 尺寸期**不再是全局门**：页面一进入就按默认宽高比把每张图排版出来（S1 立即可见），
 *      不再出现「整卡空白 + 居中圆圈」把整页按 SIZE_DEADLINE_MS 挡住的情形；
 *      探测结果按帧（rAF 合并）批量回填，几十上百项只触发一次重排；
 *   ④ 单图加载有兜底释放（IMAGE_SETTLE_TIMEOUT_MS）：外链悬挂（无响应也不报错）时
 *      释放并发槽位，后续图片继续按视口顺序加载，队列不会整条堵死；
 *   ⑤ 位图路径失败（旧浏览器 / CORS 不允许）→ 回退 <img src>，功能不降级。
 */

import { getSize, setSize } from "./photo-cache.js";
import {
	cancelPhotoBitmap,
	fetchPhotoBitmap,
	nextPhotoBitmapJobId,
	warmUpPhotoBitmap,
} from "./photo-bitmap.js";
import { probePhotoSizes } from "./photo-probe-client.js";

/** 未知尺寸项的默认宽高比占位（探测失败时先用；加载后校正成真实比例） */
const DEFAULT_ASPECT_W = 3;
const DEFAULT_ASPECT_H = 2;

const MAX_CONCURRENT = 6; // 图片内容并发加载上限
const VIEWPORT_MARGIN = "600px 0px"; // 视口预载边距
const RATIO_TOLERANCE = 0.01; // >1% 差异才校正
const PROBE_CONCURRENCY = 4; // 尺寸探测并发（Worker 内生效）
const PROBE_TIMEOUT_MS = 8000; // 单次 Range 探测超时
const SIZE_DEADLINE_MS = 8000; // 尺寸探测批次的兜底截止（不再阻塞排版，仅用于让 Worker 收工）
const IMAGE_SETTLE_TIMEOUT_MS = 20000; // 单图加载兜底：只释放队列槽位，图片晚到仍会显示
const BITMAP_TIMEOUT_MS = 20000; // 单张图「取图 + 解码」超时（Worker 内 + 客户端双重截止）

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

/** 26.09.14：标记容器已排版完成（历史门控类，当前无 CSS 依赖；保留供未来门控/调试使用）。 */
function markSizingDone(container: HTMLElement): void {
	container.classList.add("gallery-ready");
}

/**
 * 单一容器编排。容器只初始化一次（WeakSet 防重）。
 */
const initializedContainers = new WeakSet<Element>();
let activeAbort: AbortController | null = null;

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

	// 预热位图 Worker：首屏图片进场时不用再等 Worker 创建（失败即静默回退 <img>）
	warmUpPhotoBitmap();

	// ---------- S0 / S1：尺寸期 ----------
	if (layout === "masonry") {
		// 26.09.14：尺寸期不再阻塞排版 —— applyProvisionalDims 立刻给未知项默认比例，
		// 整页排版一次完成；随后 Worker 探到的真实尺寸按帧批量回填（flushSizes）。
		applyProvisionalDims(figures);
		markSizingDone(container);
		void probeSizes(figures, signal);
	} else {
		// grid：CSS 1:1 裁剪，盒子比例由 CSS 决定，无需尺寸
		markSizingDone(container);
	}

	// ---------- S2：加载期 ----------
	startLazyLoading(figures, layout, signal);
}

/**
 * 立即排版：未知尺寸的项按默认宽高比占位。
 * 这一步是「外链不可达不再卡死」的关键 —— 探测再慢也不影响页面已经可读、可滚动。
 */
function applyProvisionalDims(figures: HTMLElement[]): void {
	for (const figure of figures) {
		if (readDimAttr(figure)) continue;
		const cached = getSize(figure.getAttribute("data-key") || "");
		if (cached) {
			applyDim(figure, cached.w, cached.h, true);
			continue;
		}
		figure.classList.add("photo-dim-fallback");
		applyDim(figure, DEFAULT_ASPECT_W, DEFAULT_ASPECT_H);
	}
}

/**
 * 尺寸探测（26.09.14：改由 Web Worker 承担，主线程不跑请求/解析）。
 * 探到的结果**按帧批量回填**：一个 rAF 内只写一次 DOM / 触发一次重排，
 * 因此几十上百项同时返回也不会把主线程按在样式重算里。
 */
async function probeSizes(
	figures: HTMLElement[],
	signal: AbortSignal,
): Promise<void> {
	// key → figure：Worker 只回传 key，需在结果回调里定位到对应 figure
	const byKey = new Map<string, HTMLElement>();
	const jobs: Array<{ key: string; src: string }> = [];
	for (const figure of figures) {
		const key = figure.getAttribute("data-key") || "";
		if (!key) continue;
		const src = figureSrc(figure);
		if (!src) continue;
		byKey.set(key, figure);
		jobs.push({ key, src });
	}
	if (jobs.length === 0) return;

	// 每帧要应用的尺寸回填（key → dim）；同一帧内多次结果合并成一次样式写入
	const pending = new Map<string, { w: number; h: number }>();
	let flushScheduled = false;
	const flush = (): void => {
		flushScheduled = false;
		if (pending.size === 0) return;
		const batch = Array.from(pending.entries());
		pending.clear();
		for (const [key, dim] of batch) {
			const figure = byKey.get(key);
			if (!figure || !figure.isConnected) continue;
			// 用户已看图或已失败：不再动盒子，避免加载后被重排
			if (
				figure.classList.contains("photo-loaded") ||
				figure.classList.contains("photo-error")
			) {
				continue;
			}
			figure.classList.remove("photo-dim-fallback");
			applyDim(figure, dim.w, dim.h, true);
			// 写缓存统一在 flush 内做（一次一帧，localStorage 写入不散落在回调里）
			setSize(key, dim.w, dim.h);
		}
	};

	await probePhotoSizes(jobs, {
		signal,
		concurrency: PROBE_CONCURRENCY,
		timeoutMs: PROBE_TIMEOUT_MS,
		deadlineMs: SIZE_DEADLINE_MS,
		onResult: (key, w, h) => {
			if (!(w > 0 && h > 0)) return;
			pending.set(key, { w, h });
			if (flushScheduled) return;
			flushScheduled = true;
			// 批量回填：只在本帧末写一次 DOM
			if (typeof requestAnimationFrame === "function") {
				requestAnimationFrame(flush);
			} else {
				setTimeout(flush, 16);
			}
		},
	});
	// 收尾：把最后一批（可能还没到帧）立即落地
	if (flushScheduled) {
		if (typeof requestAnimationFrame === "function") {
			requestAnimationFrame(flush);
		} else {
			setTimeout(flush, 0);
		}
	}
}

/** 读取一个 figure 的目标图片地址（figure 属性 / 内部 img / 链接 data-src 三处兜底）。 */
function figureSrc(figure: HTMLElement): string {
	return (
		figure.getAttribute("data-src") ||
		figure.querySelector("img")?.getAttribute("data-src") ||
		figure.querySelector("a[data-src]")?.getAttribute("data-src") ||
		""
	);
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
	let settleTimer: ReturnType<typeof setTimeout> | null = null;
	let bitmapJobId: number | null = null;
	const done = () => {
		if (finished) return;
		finished = true;
		if (settleTimer) clearTimeout(settleTimer);
		settleTimer = null;
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
	// 26.09.14：外链悬挂（连不上也收不到 error）时的兜底——只释放队列槽位，
	// 不判错、不移除监听：图片若之后真的到达，load 仍会把占位换成图片。
	settleTimer = setTimeout(() => {
		done();
	}, IMAGE_SETTLE_TIMEOUT_MS);
	// 先绑事件再赋 src：保证不丢失异步 load/error
	img.addEventListener("load", onLoad, { once: true });
	img.addEventListener("error", onError, { once: true });

	// ---------- 26.09.14：优先走「取图 + 解码」Worker（UI 线程分离） ----------
	// 主线程只做一次 drawImage；失败（旧浏览器 / CORS / 解码失败）→ 回退 <img src>。
	bitmapJobId = nextPhotoBitmapJobId();
	activeBitmapJobs.add(bitmapJobId);
	const bitmap = await fetchPhotoBitmap({
		jobId: bitmapJobId,
		src,
		timeoutMs: BITMAP_TIMEOUT_MS,
	});
	activeBitmapJobs.delete(bitmapJobId);
	bitmapJobId = null;
	if (bitmap) {
		// 成功：换掉 <img>（释放它的网络/解码路径），改用 canvas 呈现已解码的位图
		if (displayBitmap(item, bitmap)) {
			img.removeEventListener("load", onLoad);
			img.removeEventListener("error", onError);
			afterLoaded(item, layout, bitmap.width, bitmap.height, true);
			done();
			return;
		}
		// 画布不可用（极端环境）：位图已在 displayBitmap 内释放，继续走下面的 <img> 回退
	}
	if (finished || !figure.isConnected) return;

	// ---------- 回退路径：<img src>（行为与修复前一致） ----------
	img.src = src;

	// 独立完成信号 1：decode() 不依赖 load 事件时序
	// （内存/磁盘缓存瞬时完成、事件派发时机差异等边角都由此兜底）。
	if (typeof img.decode === "function") {
		img.decode()
			.then(() => {
				img.removeEventListener("load", onLoad);
				img.removeEventListener("error", onError);
				afterLoaded(item, layout);
				done();
			})
			.catch(() => {
				// decode 失败（网络/格式）：error 事件会兜底；若已处于错误终态则直接收尾
				if (img.complete && img.naturalWidth === 0) {
					img.removeEventListener("load", onLoad);
					img.removeEventListener("error", onError);
					markError(figure);
					done();
				}
			});
	}

	// 独立完成信号 2：同步缓存命中（老浏览器无 decode / complete 已为真）
	if (img.complete && img.naturalWidth > 0) {
		img.removeEventListener("load", onLoad);
		img.removeEventListener("error", onError);
		afterLoaded(item, layout);
		done();
	}
}

/**
 * 用位图替换 <img>：新建 canvas（与 <img> 同级同尺寸、复用 .photo-image 样式），
 * 一次性 drawImage 后移除 <img> 并释放位图。
 * 为什么不留着 <img>：位图若同时挂在 canvas 与 <img> 上会双份显存；
 * 直接把源文件交给 <img> 又等于回到渲染进程解码（本次要修的就是这条路径）。
 * 灯箱/Fancybox 读的是 <a data-src>，不受影响。
 * @returns true = 已接管显示；false = 放弃（位图已释放，调用方应回退 <img>）
 */
function displayBitmap(item: GalleryItem, bitmap: ImageBitmap): boolean {
	const { img } = item;
	const release = (): void => {
		try {
			bitmap.close();
		} catch {
			/* 忽略 */
		}
	};
	if (!img || !img.parentNode) {
		release();
		return false;
	}
	let canvas: HTMLCanvasElement;
	try {
		canvas = document.createElement("canvas");
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("no-2d-context");
		ctx.drawImage(bitmap, 0, 0);
	} catch {
		// 画布不可用（极端环境）：放弃位图，交给回退路径
		release();
		return false;
	}
	// 同步 <img> 上的既有契约（类名 / data-key / data-src）
	canvas.className = img.className;
	const key = img.getAttribute("data-key");
	if (key) canvas.setAttribute("data-key", key);
	canvas.setAttribute("data-src", img.getAttribute("data-src") || "");
	canvas.setAttribute("aria-hidden", "true");
	img.parentNode.replaceChild(canvas, img);
	item.img = null;
	release(); // 像素已绘制到画布，位图可立即释放
	return true;
}

/** 加载完成：显示图片 + natural 尺寸比对校正。 */
function afterLoaded(
	item: GalleryItem,
	layout: string,
	naturalWidth?: number,
	naturalHeight?: number,
	skipResize = false,
): void {
	const { figure, img, key } = item;
	figure.classList.add("photo-loaded");
	figure.classList.remove("photo-dim-fallback");
	if (skipResize) return;
	const nw = naturalWidth ?? img?.naturalWidth ?? 0;
	const nh = naturalHeight ?? img?.naturalHeight ?? 0;
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
 *  - content:replace 到达后，下一个 page:view 信号才执行 中止旧请求 + 初始化；
 *  - 同一访问的重复 page:view 信号只做幂等 tryInitAll（已初始化容器被 WeakSet 跳过，
 *    不会再 abort→restart 打乱尺寸探测）。
 * 若 content:replace 信号因任何原因丢失，page:view 仍会尝试初始化新出现的容器。
 */
let pageReadyArmed = false;
let hooksInstalled = false;
/** 当前批次在途的位图 job（切页/离开时逐个取消，Worker 内在途 fetch 随之 abort） */
const activeBitmapJobs = new Set<number>();

function cancelActiveBitmapJobs(): void {
	for (const jobId of Array.from(activeBitmapJobs)) {
		activeBitmapJobs.delete(jobId);
		cancelPhotoBitmap(jobId);
	}
}

function onPageReplaced(): void {
	// 只中止旧内容在途请求；新内容初始化由随后的 page:view 信号完成
	if (activeAbort) activeAbort.abort();
	// 26.09.14：位图 job 不挂在 AbortSignal 上（Worker 侧按 jobId 取消），单独收掉
	cancelActiveBitmapJobs();
	pageReadyArmed = true;
}

function onNewPageReady(): void {
	if (pageReadyArmed) {
		pageReadyArmed = false;
		newAbort();
	}
	// 幂等初始化：新容器会被处理；已初始化容器（含重复 page:view 信号）直接跳过
	tryInitAll();
}

/**
 * 注册 swup 生命周期（只成功注册一次）。
 * 不依赖「模块求值时 swup 是否就绪」：swup 是 loadOnIdle 空闲初始化，模块求值时必然
 * 尚未就绪；若此处用一次性标志挡住 enable 后的二次注册，content:replace 将永远收不到，
 * SPA 跳入相册页就永远不初始化（此前缺陷根因）。
 */
function installSwupHooks(): void {
	if (hooksInstalled) return;
	const swup = (window as any).swup;
	if (swup && swup.hooks && typeof swup.hooks.on === "function") {
		swup.hooks.on("content:replace", onPageReplaced);
		hooksInstalled = true;
		return;
	}
	document.addEventListener(
		"swup:enable",
		() => {
			installSwupHooks();
		},
		{ once: true },
	);
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
	// 1) swup 实例 hook（就绪后注册）
	installSwupHooks();

	// 2) DOM 级 content:replace：swup 内核会为每个 hook 派发 swup:xxx 自定义事件，
	//    与实例 hook 注册时机无关——SPA 跳入相册页时必定能武装（双保险，重复武装无害）。
	document.addEventListener("swup:content:replace", onPageReplaced);

	// 3) 首载
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", () => {
			tryInitAll();
			// 整页浏览器跳转离开时中止在途请求
			window.addEventListener("pagehide", () => {
				if (activeAbort) activeAbort.abort();
				cancelActiveBitmapJobs();
			});
		});
	} else {
		tryInitAll();
		window.addEventListener("pagehide", () => {
			if (activeAbort) activeAbort.abort();
			cancelActiveBitmapJobs();
		});
	}

	// 4) SPA 兜底：@swup/astro 在 page:view 派发 astro:page-load，swup 内核派发 swup:page:view
	document.addEventListener("astro:page-load", onNewPageReady);
	document.addEventListener("swup:page:view", onNewPageReady);
}
