/**
 * 相册瀑布流「超宽横图跨列」运行期排版（26.09.21）。
 *
 * 方案 B：CSS Grid + 行跨。只在「相册是 masonry + 配置开关打开 + 相册清单里给了参数」时
 * 接管排版；其余情况返回 null，页面保持原来的 CSS 多列瀑布流（无 JS 也照旧可读）。
 *
 * 分工：
 *   - 本文件负责 DOM：读尺寸/配置 → 调 masonry-pack 纯函数 → 写 grid-column/row 内联样式；
 *   - 跨列规则：宽高比 ≥ data-span-min-aspect 的照片最多跨 data-span-max 列（上限 2）；
 *   - 自适应间距：data-gap-adaptive（px）交给 packing 内核消化跨列留下的空洞；
 *   - 尺寸变化（Worker 探测回填、加载后校正）与容器宽度/断点变化都会触发重排，
 *     重排本身走 rAF 合帧，且只写内联样式，不重新创建 DOM。
 */

import { packMasonry } from "./masonry-pack.js";
import type { MasonryPackInput } from "./masonry-pack.js";

/** 行量化单位（px）：必须与 albums/[id]/index.astro 里 grid-auto-rows 的值一致 */
const ROW_UNIT = 4;
/** 尺寸未知时的兜底宽高比：与 album-gallery.ts 的 DEFAULT_ASPECT_* 一致 */
const FALLBACK_ASPECT = 3 / 2;
/** 触发跨列的宽高比默认值（配置缺省时使用） */
const DEFAULT_MIN_ASPECT = 2.2;
/** 跨列数硬上限：本次只允许最多跨 2 列 */
const MAX_SPAN_HARD_LIMIT = 2;

export interface MasonryGridLayout {
	/** 请求重排（rAF 合并；同一帧内多次调用只排一次） */
	relayout(): void;
	/** 解绑观察器与监听（切页 / 中止时调用） */
	dispose(): void;
}

function toNumber(value: string | null, fallback: number): number {
	if (value === null) return fallback;
	const n = Number(value);
	return Number.isFinite(n) ? n : fallback;
}

/**
 * 列数解析：与 index.astro 的媒体查询逐条对齐
 *   - ≥1024px 且 data-columns="4" → 4 列
 *   - ≥768px → 3 列（data-columns 为 2/3 时在宽屏也是 3 列，属既有行为）
 *   - 其余 → 2 列
 * 这里用 matchMedia（视口）而不是容器宽度，保证与 CSS 的判定条件完全一致。
 */
function resolveColumns(container: HTMLElement): number {
	const dataColumns = toNumber(container.getAttribute("data-columns"), 3);
	const canMatch =
		typeof window !== "undefined" && typeof window.matchMedia === "function";
	const isWide = canMatch
		? window.matchMedia("(min-width: 1024px)").matches
		: true;
	const isMedium = canMatch
		? window.matchMedia("(min-width: 768px)").matches
		: true;
	if (isWide && dataColumns >= 4) return 4;
	if (isMedium) return 3;
	return 2;
}

/** 读取容器实际生效的列间距（grid/columns 两种模式同值，均取自 column-gap） */
function readGap(container: HTMLElement): number {
	if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") {
		return 16;
	}
	const style = window.getComputedStyle(container);
	const gap = Number.parseFloat(style.columnGap || style.gap || "");
	return Number.isFinite(gap) && gap >= 0 ? gap : 16;
}

/** 从 data-dim / 内联 aspect-ratio / img 宽高属性里取宽高比；都取不到用兜底值 */
function readAspect(figure: HTMLElement): number {
	const dim = figure.getAttribute("data-dim");
	if (dim) {
		const matched = /^\s*(\d+)\s*[,xX]\s*(\d+)\s*$/.exec(dim);
		if (matched) {
			const w = Number(matched[1]);
			const h = Number(matched[2]);
			if (w > 0 && h > 0) return w / h;
		}
	}
	const ratio = figure.style.aspectRatio;
	if (ratio) {
		const parts = ratio.split("/");
		const w = Number.parseFloat(parts[0]);
		const h = Number.parseFloat(parts[1] ?? "");
		if (w > 0 && h > 0) return w / h;
	}
	const w = toNumber(figure.getAttribute("width"), 0);
	const h = toNumber(figure.getAttribute("height"), 0);
	if (w > 0 && h > 0) return w / h;
	return FALLBACK_ASPECT;
}

function queryFigures(container: HTMLElement): HTMLElement[] {
	const figures: HTMLElement[] = [];
	container.querySelectorAll(":scope > figure.photo-item").forEach((node) => {
		if (node instanceof HTMLElement) figures.push(node);
	});
	return figures;
}

/**
 * 挂载 Grid 行跨排版。返回 null = 不接管（开关关闭、非瀑布流、无照片、宽度不可用）。
 */
export function mountMasonryGrid(
	container: HTMLElement,
	signal?: AbortSignal,
): MasonryGridLayout | null {
	if (!container || (container.getAttribute("data-layout") || "") !== "masonry") {
		return null;
	}
	if (container.getAttribute("data-span-enable") !== "1") return null;

	const maxSpanRaw = toNumber(container.getAttribute("data-span-max"), 1);
	const maxSpan = Math.min(
		MAX_SPAN_HARD_LIMIT,
		Math.max(1, Math.floor(maxSpanRaw)),
	);
	if (maxSpan < 2) return null; // 上限 1 = 不跨列，等同于关闭

	const minAspect = Math.max(
		1,
		toNumber(container.getAttribute("data-span-min-aspect"), DEFAULT_MIN_ASPECT),
	);
	const gapAdaptive = Math.max(
		0,
		toNumber(container.getAttribute("data-gap-adaptive"), 0),
	);

	const figures = queryFigures(container);
	if (figures.length === 0) return null;

	let frame = 0;
	let disposed = false;
	let lastWidth = -1;
	let lastColumns = -1;

	const applyPlacements = (): void => {
		const columns = resolveColumns(container);
		const gap = readGap(container);
		const width = container.clientWidth;
		if (width <= 0) return;
		const columnWidth = (width - gap * (columns - 1)) / columns;
		if (!(columnWidth > 0)) return;

		container.style.setProperty("--masonry-cols", String(columns));

		const items: MasonryPackInput[] = figures.map((figure) => {
			const aspect = readAspect(figure);
			return { aspect, maxSpan: aspect >= minAspect ? maxSpan : 1 };
		});

		const packed = packMasonry(items, {
			columns,
			columnWidth,
			gap,
			rowUnit: ROW_UNIT,
			gapAdaptive,
		});

		// 先把容器切到 grid，再写每一项的行列（顺序无所谓，同一次样式计算内生效）
		container.setAttribute("data-masonry", "grid");

		figures.forEach((figure, index) => {
			const placement = packed.placements[index];
			if (!placement) return;
			figure.style.gridColumnStart = String(placement.column + 1);
			figure.style.gridColumnEnd = `span ${placement.span}`;
			figure.style.gridRowStart = String(placement.rowStart + 1);
			figure.style.gridRowEnd = `span ${placement.rowSpan}`;
			if (placement.span > 1) {
				figure.setAttribute("data-span-cols", String(placement.span));
			} else {
				figure.removeAttribute("data-span-cols");
			}
		});

		lastWidth = width;
		lastColumns = columns;
	};

	const layout = (): void => {
		if (disposed) return;
		applyPlacements();
	};

	const relayout = (): void => {
		if (disposed || frame !== 0) return;
		const run = (): void => {
			frame = 0;
			layout();
		};
		if (typeof requestAnimationFrame === "function") {
			frame = requestAnimationFrame(run);
		} else {
			frame = 1;
			setTimeout(run, 16);
		}
	};

	/** 容器尺寸变化：只在「宽度或列数」真的变了才重排（自身重排会改高度，必须忽略） */
	const onResize = (): void => {
		if (disposed) return;
		const width = container.clientWidth;
		const columns = resolveColumns(container);
		if (width === lastWidth && columns === lastColumns) return;
		relayout();
	};

	let resizeObserver: ResizeObserver | null = null;
	if (typeof ResizeObserver === "function") {
		resizeObserver = new ResizeObserver(onResize);
		resizeObserver.observe(container);
	} else if (typeof window !== "undefined") {
		window.addEventListener("resize", onResize);
	}

	// 断点切换（列数变化）也要重排：ResizeObserver 只在元素尺寸变化时触发
	const mediaQueries: MediaQueryList[] = [];
	if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
		mediaQueries.push(
			window.matchMedia("(min-width: 768px)"),
			window.matchMedia("(min-width: 1024px)"),
		);
		for (const mediaQuery of mediaQueries) {
			if (typeof mediaQuery.addEventListener === "function") {
				mediaQuery.addEventListener("change", onResize);
			}
		}
	}

	const dispose = (): void => {
		if (disposed) return;
		disposed = true;
		if (typeof cancelAnimationFrame === "function" && frame) {
			cancelAnimationFrame(frame);
		}
		frame = 0;
		resizeObserver?.disconnect();
		resizeObserver = null;
		for (const mediaQuery of mediaQueries) {
			if (typeof mediaQuery.removeEventListener === "function") {
				mediaQuery.removeEventListener("change", onResize);
			}
		}
		if (typeof window !== "undefined") {
			window.removeEventListener("resize", onResize);
		}
	};

	if (signal) {
		if (signal.aborted) {
			dispose();
			return null;
		}
		signal.addEventListener("abort", dispose, { once: true });
	}

	layout();
	return { relayout, dispose };
}
