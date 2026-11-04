/**
 * 友链卡片「双站点跳转」数据归一化（26.11.03 新增）。
 *
 * friends.json 单条可选的额外字段（全部可选，缺省时行为与原「访问」按钮完全一致）：
 *   imgurl                     : 站点图标；为空（缺失 / 空串 / 纯空白）时按第一个网页链接自动生成
 *                                Google favicon 地址：https://www.google.com/s2/favicons?domain=<第一个链接>/&sz=128
 *   siteurl                    : 站点链接；也支持「数组语法糖」——
 *                                ["第一个网页", "第二个网页"] 依次作为 first_siteurl / second_siteurl 的缺省值，
 *                                ["第一个网页"] 只作为 first_siteurl 的缺省值；
 *                                first_siteurl / second_siteurl 非空时覆盖对应缺省值（为空则仍用缺省值）
 *   first / second             : 按钮名称（仅 zh_CN / zh_TW 会采用，非简中繁中语言按 i18n 固定文案）
 *   first_color / second_color : 相对当前主题色（--hue）的色相偏移，默认 first=0、second=180；
 *                                超出 0–360 按 360 取余（负数归一到 0–359）
 *   first_siteurl              : 第一个网页链接；非空时覆盖 siteurl（数组取第一个元素）缺省值
 *   second_siteurl             : 第二个网页链接；非空时覆盖 siteurl 数组第二个元素缺省值
 *   first_active / second_active  : 是否启用该网页，默认 true（first_actived / second_actived 为兼容别名）
 *
 * 「启用」判定：链接存在且不为空，并且对应 active !== false。
 * 所有链接（含 siteurl 缺省值与覆盖值）解析后都为空的友链不渲染（hasUrl=false，由页面过滤掉）。
 * 本模块只做纯数据决策，不依赖 DOM / 浏览器 API，便于用 node 直接断言。
 */

/** friends.json 中与友链跳转相关的可选字段（unknown 兼容手写 JSON 的类型漂移） */
export interface FriendRawItem {
	/** 站点图标；为空（缺失 / 空串 / 纯空白）时按第一个网页链接自动生成 Google favicon 地址 */
	imgurl?: string;
	/** 站点链接；数组语法糖：依次作为 first_siteurl / second_siteurl 的缺省值 */
	siteurl?: string | string[];
	first?: string;
	first_color?: number | string;
	first_siteurl?: string;
	first_active?: boolean | number | string;
	/** 兼容规格书里的 first_actived 写法（first_active 优先） */
	first_actived?: boolean | number | string;
	second?: string;
	second_color?: number | string;
	second_siteurl?: string;
	second_active?: boolean | number | string;
	/** 兼容规格书里的 second_actived 写法（second_active 优先） */
	second_actived?: boolean | number | string;
}

/** 由 i18n 提供的按钮文案（visit：单站点默认；main/backup：双站点左右） */
export interface FriendLabelSet {
	visit: string;
	main: string;
	backup: string;
}

/** 一个已启用的跳转按钮 */
export interface FriendSiteButton {
	key: "first" | "second";
	url: string;
	label: string;
	/** 归一化后的色相偏移（0–359） */
	hueOffset: number;
}

/** 单张友链卡片的最终渲染数据 */
export interface FriendCardView {
	/** 卡片标题上方的站点链接（first_siteurl 优先，其次 siteurl，再次 second_siteurl） */
	siteUrl: string;
	/** 站点链接的显示文本（new URL 解析失败时回退为原串） */
	hostname: string;
	/** 已启用的跳转按钮：0 / 1 / 2 个 */
	buttons: FriendSiteButton[];
	/** 复制按钮要复制的链接：双站点时为左侧（first），未启用任何站点时为空串 */
	copyUrl: string;
	layout: "none" | "single" | "dual";
	/** 卡片图标：imgurl 非空时原样使用；为空时按第一个网页链接生成 Google favicon 地址 */
	imgUrl: string;
	/** 解析后是否还存在任何链接；false 表示「siteurl 全空且无覆盖值」→ 该友链不渲染 */
	hasUrl: boolean;
}

/** 取字符串并去首尾空白；非字符串一律当作空串 */
function text(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

/** 解析数值字段：支持 number 与数字字符串；无法解析时返回 NaN */
function numeric(value: unknown): number {
	if (typeof value === "number") return value;
	if (typeof value === "string" && value.trim() !== "") {
		return Number.parseFloat(value);
	}
	return Number.NaN;
}

/**
 * 归一化色相偏移：非数字回退 fallback；否则按 360 取余（负数归一到 0–359）。
 * 例：400 → 40、720 → 0、-30 → 330、"180" → 180、"abc" → fallback
 */
export function normalizeHueOffset(value: unknown, fallback: number): number {
	const parsed = numeric(value);
	if (!Number.isFinite(parsed)) return fallback;
	const mod = parsed % 360;
	return mod < 0 ? mod + 360 : mod;
}

/**
 * 解析 active 字段：未填（undefined / null / 空串）按 fallback（默认 true）；
 * boolean 原样；number 0 → false；字符串 "false"/"0"/"no"/"off"（忽略大小写与空白）→ false。
 */
export function resolveActive(value: unknown, fallback = true): boolean {
	if (value === undefined || value === null || value === "") return fallback;
	if (typeof value === "boolean") return value;
	if (typeof value === "number") return value !== 0;
	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		if (normalized === "") return fallback;
		return !["false", "0", "no", "off"].includes(normalized);
	}
	return fallback;
}

/** 取 URL 的 hostname；解析失败（空串 / 非法链接）时回退为原串，避免构建期抛错 */
export function safeHostname(url: string): string {
	if (!url) return "";
	try {
		return new URL(url).hostname;
	} catch {
		return url;
	}
}

/**
 * 解析卡片图标：imgurl 为空（缺失 / 空串 / 纯空白）时，用第一个网页链接生成 Google favicon 地址：
 * `https://www.google.com/s2/favicons?domain=<第一个网页链接>/&sz=128`
 * （链接末尾已有斜杠时不重复添加；完全没有链接时返回空串，此时友链本身也不会渲染）。
 */
export function resolveFriendImgUrl(
	imgurl: unknown,
	primaryUrl: string,
): string {
	const raw = text(imgurl);
	if (raw !== "") return raw;
	if (primaryUrl === "") return "";
	return `https://www.google.com/s2/favicons?domain=${primaryUrl.replace(/\/+$/, "")}/&sz=128`;
}

/**
 * siteurl 数组语法糖：把 siteurl 拆成 first / second 的缺省链接。
 * - 字符串：整体作为 first 缺省值（second 无缺省值）
 * - 数组：第 1 个元素 → first 缺省值，第 2 个元素 → second 缺省值（多出的元素忽略）
 */
function resolveSiteUrlDefaults(
	value: FriendRawItem["siteurl"],
): { first: string; second: string } {
	if (Array.isArray(value)) {
		return { first: text(value[0]), second: text(value[1]) };
	}
	return { first: text(value), second: "" };
}

/**
 * 把 friends.json 的一条数据解析成卡片渲染数据。
 *
 * @param raw          friends.json 原始条目
 * @param labels       当前语言的按钮文案（i18n）
 * @param useJsonNames 是否采用 JSON 里的 first/second 名称（仅 zh_CN / zh_TW 为 true）
 */
export function parseFriendLinks(
	raw: FriendRawItem,
	labels: FriendLabelSet,
	useJsonNames: boolean,
): FriendCardView {
	// siteurl 可写字符串或数组：数组元素只是 first/second 的缺省值，显式且非空的 first_siteurl / second_siteurl 优先覆盖
	const siteUrlDefaults = resolveSiteUrlDefaults(raw.siteurl);
	const firstUrl = text(raw.first_siteurl) || siteUrlDefaults.first;
	const secondUrl = text(raw.second_siteurl) || siteUrlDefaults.second;

	const firstActive = resolveActive(raw.first_active ?? raw.first_actived);
	const secondActive = resolveActive(raw.second_active ?? raw.second_actived);

	const firstEnabled = firstUrl !== "" && firstActive;
	const secondEnabled = secondUrl !== "" && secondActive;

	// 每个槽位：色相偏移默认值（first 0 / second 180）+ 单站点默认文案 + 双站点默认文案
	const slots: {
		key: "first" | "second";
		url: string;
		hueOffset: number;
		jsonName: string;
		singleFallback: string;
		dualFallback: string;
	}[] = [];
	if (firstEnabled) {
		slots.push({
			key: "first",
			url: firstUrl,
			hueOffset: normalizeHueOffset(raw.first_color, 0),
			jsonName: text(raw.first),
			singleFallback: labels.visit,
			dualFallback: labels.main,
		});
	}
	if (secondEnabled) {
		slots.push({
			key: "second",
			url: secondUrl,
			hueOffset: normalizeHueOffset(raw.second_color, 180),
			jsonName: text(raw.second),
			// 简中/繁中环境下「仅备用站点启用」显示备用名（备用/備用）
			singleFallback: useJsonNames ? labels.backup : labels.visit,
			dualFallback: labels.backup,
		});
	}

	const layout: FriendCardView["layout"] =
		slots.length >= 2 ? "dual" : slots.length === 1 ? "single" : "none";

	const buttons: FriendSiteButton[] = slots.map((slot) => {
		const fallback = layout === "dual" ? slot.dualFallback : slot.singleFallback;
		return {
			key: slot.key,
			url: slot.url,
			label: useJsonNames ? slot.jsonName || fallback : fallback,
			hueOffset: slot.hueOffset,
		};
	});

	const siteUrl = firstUrl || secondUrl;

	return {
		siteUrl,
		hostname: safeHostname(siteUrl),
		buttons,
		copyUrl: buttons.length > 0 ? buttons[0].url : "",
		layout,
		// imgurl 为空时按第一个网页链接自动生成 favicon 地址
		imgUrl: resolveFriendImgUrl(raw.imgurl, siteUrl),
		// 解析后没有任何链接（siteurl 全空且无覆盖值）→ 该友链整体不渲染
		hasUrl: firstUrl !== "" || secondUrl !== "",
	};
}
