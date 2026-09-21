/**
 * 相册瀑布流「跨列打包」纯函数（26.09.21）。
 *
 * 背景：CSS 多列瀑布流（columns + break-inside: avoid）里每张图只能待在自己那一列，
 * 超宽横图（Acg2 的 7655×1760 ≈ 4.35:1）会被压成一条细横线。跨列只能换布局模型，
 * 本文件是方案 B（CSS Grid + 行跨）的排版内核：只做数学，不碰 DOM，便于单测。
 *
 * 两条目标：
 *   ① 放置：每一项都放到「放下去之后能开始得最早」的列（等价于经典瀑布流的最短列；
 *      并列时取更左）。跨列项在所有能容纳它的相邻列窗口里做同样的选择，并列时取
 *      「空洞更小」的窗口 —— 空洞 = 窗口内各列可用起点之间的落差，也就是跨列项上方
 *      会多出来的那块空白。窗口选得对，空白常常能小一个数量级。
 *   ② 自适应间距：跨列项必须等窗口内所有列都空出来才能开始，落差在别的列上必然留下
 *      空洞。把每个空洞「就近向上」摊到该列更早的间隙里（每个间隙最多 +gapAdaptive px），
 *      空白就被消化成均匀的间距，而不是留在跨列项上方的一块白。跨列项的位置被多列共享，
 *      永不下移；单列项才会被下移。
 *
 * 注意：本内核刻意不做「回填」（不把后面的小图塞进前面的空洞）——回填会让视觉顺序与
 * 相册顺序错位（实测第 7 张会跑到跨列图上方）。顺序稳定优先，空白交给 ② 处理。
 */

export interface MasonryPackInput {
	/** 宽高比 w / h（> 0；未知时由调用方给兜底比例） */
	aspect: number;
	/** 允许的最大跨列数（1 = 只占一列，2 = 最多跨两列）；会被钳制到 [1, columns] */
	maxSpan: number;
}

export interface MasonryPackOptions {
	/** 列数 */
	columns: number;
	/** 单列宽度（px，不含间距） */
	columnWidth: number;
	/** 基础间距（px，列间距与行间距同值） */
	gap: number;
	/** 行量化单位（px），必须与 CSS 的 grid-auto-rows 一致 */
	rowUnit: number;
	/** 单个间隙最多额外撑开多少 px（自适应消化跨列留白）；0 / 缺省 = 关闭 */
	gapAdaptive?: number;
}

export interface MasonryPlacement {
	/** 起始列（0 基） */
	column: number;
	/** 跨几列 */
	span: number;
	/** 顶边（px，已含自适应间距带来的下移） */
	top: number;
	/** 盒宽（px） */
	width: number;
	/** 盒高（px，由宽高比决定，不随跨列拉伸） */
	height: number;
	/** grid-row-start（0 基，写样式时 +1） */
	rowStart: number;
	/** grid-row-end 的 span 值 */
	rowSpan: number;
}

export interface MasonryPackResult {
	placements: MasonryPlacement[];
	/** 内容总高（px） */
	height: number;
	/**
	 * 自适应之后，列内最大的「额外空隙」（px，即超出基础间距的那部分）。
	 * 注意它的下界就是 gapAdaptive：撑开后的间隙本身也算额外空隙。
	 * 所以 值 == gapAdaptive 表示原空洞已被摊完；值 > gapAdaptive 表示还有没摊掉的部分。
	 */
	maxVoid: number;
}

const DEFAULT_ASPECT = 3 / 2;
const EPS = 0.5;

interface Draft {
	column: number;
	span: number;
	top: number;
	width: number;
	height: number;
}

/**
 * 打包：按给定顺序放置，返回每一项的列/行位置。
 * 顺序 = 相册顺序（DOM 顺序），函数内部不做任何重排。
 */
export function packMasonry(
	items: readonly MasonryPackInput[],
	options: MasonryPackOptions,
): MasonryPackResult {
	const columns = Math.max(1, Math.floor(options.columns) || 1);
	const columnWidth = Math.max(1, options.columnWidth);
	const gap = Math.max(0, options.gap);
	const rowUnit = Math.max(1, options.rowUnit);
	const stretchCap = Math.max(0, options.gapAdaptive ?? 0);

	const ends = new Array<number>(columns).fill(0);
	const drafts: Draft[] = [];
	const perColumn: number[][] = Array.from({ length: columns }, () => []);

	for (let index = 0; index < items.length; index++) {
		const item = items[index];
		const aspect =
			Number.isFinite(item.aspect) && item.aspect > 0
				? item.aspect
				: DEFAULT_ASPECT;
		const wanted = Math.max(1, Math.floor(item.maxSpan) || 1);
		const span = Math.min(wanted, columns);
		const width = span * columnWidth + (span - 1) * gap;
		const height = width / aspect;

		// 选窗口：主键「可开始得最早」，并列时取窗口内落差（空洞）更小者，再并列取最左。
		let chosen = 0;
		let chosenTop = Number.POSITIVE_INFINITY;
		let chosenVoid = Number.POSITIVE_INFINITY;
		for (let start = 0; start + span <= columns; start++) {
			let top = 0;
			let minStart = Number.POSITIVE_INFINITY;
			let maxStart = 0;
			for (let k = start; k < start + span; k++) {
				const available = ends[k] > 0 ? ends[k] + gap : 0;
				if (available > top) top = available;
				if (available < minStart) minStart = available;
				if (available > maxStart) maxStart = available;
			}
			const voidSize = maxStart - minStart;
			if (
				top < chosenTop - EPS ||
				(Math.abs(top - chosenTop) <= EPS && voidSize < chosenVoid - EPS)
			) {
				chosen = start;
				chosenTop = top;
				chosenVoid = voidSize;
			}
		}

		for (let k = chosen; k < chosen + span; k++) {
			ends[k] = chosenTop + height;
			perColumn[k].push(index);
		}
		drafts.push({
			column: chosen,
			span,
			top: chosenTop,
			width,
			height,
		});
	}

	// ② 自适应间距：把列内空洞就近向上摊到更早的间隙
	const shift = new Array<number>(items.length).fill(0);
	if (stretchCap > 0) {
		const currentTop = (index: number): number => drafts[index].top + shift[index];
		for (let c = 0; c < columns; c++) {
			const list = perColumn[c];
			if (list.length < 2) continue;
			const used = new Array<number>(list.length).fill(0);
			for (let j = 1; j < list.length; j++) {
				const lowerIndex = list[j];
				const upperIndex = list[j - 1];
				let remain =
					currentTop(lowerIndex) -
					(currentTop(upperIndex) + drafts[upperIndex].height) -
					gap;
				if (remain <= EPS) continue;
				// 就近向上：间隙 k 位于 list[k-1] 与 list[k] 之间
				for (let k = j - 1; k >= 1 && remain > EPS; k--) {
					const lower = list[k];
					// 跨列项位置被多列共享，不能下移；遇到它就停止向上摊
					if (drafts[lower].span > 1) break;
					const room = stretchCap - used[k];
					if (room <= EPS) continue;
					const add = Math.min(remain, room);
					used[k] += add;
					// 撑开间隙 k ⇒ list[k..j-1] 整体下移（逐个验证过都是单列项）
					for (let s = k; s <= j - 1; s++) shift[list[s]] += add;
					remain -= add;
				}
			}
		}
	}

	const placements: MasonryPlacement[] = drafts.map((draft, index) => {
		const top = draft.top + shift[index];
		return {
			column: draft.column,
			span: draft.span,
			top,
			width: draft.width,
			height: draft.height,
			// ceil：行起点只会比真实顶边晚（多出 < rowUnit 的缝），绝不会早于上一项而重叠
			rowStart: Math.ceil(top / rowUnit),
			rowSpan: Math.max(1, Math.ceil((draft.height + gap) / rowUnit)),
		};
	});

	let height = 0;
	for (const placement of placements) {
		const bottom = placement.top + placement.height;
		if (bottom > height) height = bottom;
	}

	// 残留空洞（自适应之后）：跨列项与上一项之间剩下的空白
	let maxVoid = 0;
	for (let c = 0; c < columns; c++) {
		const list = perColumn[c];
		for (let j = 1; j < list.length; j++) {
			const upper = placements[list[j - 1]];
			const lower = placements[list[j]];
			const remain =
				lower.top - (upper.top + upper.height) - gap;
			if (remain > maxVoid) maxVoid = remain;
		}
	}

	return { placements, height, maxVoid };
}
