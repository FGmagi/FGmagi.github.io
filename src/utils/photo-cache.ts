/**
 * 相册照片「尺寸缓存」（双端可用）。
 *
 * - 浏览器：写入 localStorage，命名空间前缀 `mzAlbumPhoto:`，键 = photoKey 原始复合串（不编码）。
 *   值 = {"w":..,"h":..,"t":<epoch_ms>}；schema 头键 `mzAlbumPhoto:schema` = "1"。
 *   26.09.14：运行期探测复核过的条目额外带 `"v":"1"`（校验版本，见 PHOTO_CACHE_VERIFY_SCHEMA），
 *   用于「构建期已知尺寸」的运行期校验式预取；老条目无 v 仍按旧语义可读。
 * - 无 localStorage 环境（SSR/build/Node 测试）：安全降级为进程内内存 Map，绝不抛错。
 *
 * 与既有根级键（theme / postListLayout / simpleMode 等）互不干扰：本模块只读写自己前缀的键。
 * 运行期尺寸探测/校正结果一律只写本缓存，绝不回写构建产物。
 */

export interface CachedPhotoSize {
	w: number;
	h: number;
	t: number; // epoch ms
	/** 26.09.14：校验版本号（仅运行期探测所得条目写入；见 PHOTO_CACHE_VERIFY_SCHEMA） */
	v?: string;
}

export const PHOTO_CACHE_PREFIX = "mzAlbumPhoto:";
export const PHOTO_CACHE_SCHEMA_KEY = `${PHOTO_CACHE_PREFIX}schema`;
export const PHOTO_CACHE_SCHEMA = "1";
/**
 * 26.09.14：校验版本。构建期 sharp 探测出的尺寸在运行期会被 Range 探测复核一次，
 * 复核通过的条目写入本版本号（字段 `v`）。
 * 语义：升版本即可强制「重新校验」而不必清缓存（旧版本号的条目会被 verifiedOnly 视为未校验）。
 */
export const PHOTO_CACHE_VERIFY_SCHEMA = "1";

/** 修剪上限：超过该条数按 t 清最旧 20% */
export const PHOTO_CACHE_MAX_KEYS = 800;
/** 有效期：超过该毫秒数的条目清除 */
export const PHOTO_CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
/** sweepByKeys 节流间隔（毫秒） */
export const PHOTO_CACHE_SWEEP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

type StorageLike = Pick<
	Storage,
	"getItem" | "setItem" | "removeItem" | "key" | "length"
>;

function detectStorage(): StorageLike | null {
	try {
		if (
			typeof localStorage !== "undefined" &&
			localStorage &&
			typeof localStorage.getItem === "function"
		) {
			// 确认可写（隐私模式等场景可能抛错）
			const probe = `${PHOTO_CACHE_PREFIX}probe`;
			localStorage.setItem(probe, "1");
			localStorage.removeItem(probe);
			return localStorage;
		}
	} catch {
		/* 降级内存 */
	}
	return null;
}

const memoryStore = new Map<string, string>();
let storage: StorageLike | null = detectStorage();

function now(): number {
	return Date.now();
}

/** 遍历某个存储的全部键（仅限我们的前缀）。 */
function* prefixKeys(store: StorageLike): Generator<string> {
	for (let i = 0; i < store.length; i++) {
		const k = store.key(i);
		if (k && k.startsWith(PHOTO_CACHE_PREFIX)) yield k;
	}
}

function readRaw(key: string): string | null {
	const fullKey = PHOTO_CACHE_PREFIX + key;
	if (storage) {
		try {
			return storage.getItem(fullKey);
		} catch {
			return null;
		}
	}
	return memoryStore.get(fullKey) ?? null;
}

function writeRaw(fullKey: string, value: string): void {
	if (storage) {
		try {
			storage.setItem(fullKey, value);
			return;
		} catch {
			/* 降级内存 */
		}
	}
	memoryStore.set(fullKey, value);
}

function removeRaw(fullKey: string): void {
	if (storage) {
		try {
			storage.removeItem(fullKey);
		} catch {
			/* ignore */
		}
	}
	memoryStore.delete(fullKey);
}

function parseEntry(raw: string): CachedPhotoSize | null {
	try {
		const v = JSON.parse(raw) as Partial<CachedPhotoSize>;
		if (
			typeof v?.w === "number" &&
			typeof v?.h === "number" &&
			Number.isFinite(v.w) &&
			Number.isFinite(v.h) &&
			v.w > 0 &&
			v.h > 0 &&
			(typeof v.t === "number" || typeof v.t === "undefined")
		) {
			const entry: CachedPhotoSize = {
				w: v.w,
				h: v.h,
				t: typeof v.t === "number" ? v.t : now(),
			};
			// 26.09.14：带出校验标记（仅字符串有效；其它类型一律丢弃）
			if (typeof v.v === "string") entry.v = v.v;
			return entry;
		}
	} catch {
		/* invalid */
	}
	return null;
}

function ensureSchema(): void {
	if (!storage) return;
	try {
		if (storage.getItem(PHOTO_CACHE_SCHEMA_KEY) !== PHOTO_CACHE_SCHEMA) {
			storage.setItem(PHOTO_CACHE_SCHEMA_KEY, PHOTO_CACHE_SCHEMA);
		}
	} catch {
		/* ignore */
	}
}

/**
 * 读取某 photoKey 的缓存尺寸。键必须不带前缀。
 * 损坏/过期条目返回 null（并把过期条目顺手清掉）。
 * 26.09.14：options.verifiedOnly = true 时只认「本版校验号」条目；不传该选项时与旧版行为完全一致。
 */
export function getSize(
	key: string,
	options?: { verifiedOnly?: boolean },
): CachedPhotoSize | null {
	if (!key) return null;
	const raw = readRaw(key);
	if (raw === null) return null;
	const entry = parseEntry(raw);
	if (!entry) return null;
	if (Date.now() - entry.t > PHOTO_CACHE_TTL_MS) {
		removeRaw(PHOTO_CACHE_PREFIX + key);
		return null;
	}
	// 校验未通过的条目只对「校验式调用方」不可见：不删除，普通读取仍可用
	if (
		options?.verifiedOnly === true &&
		entry.v !== PHOTO_CACHE_VERIFY_SCHEMA
	) {
		return null;
	}
	return entry;
}

/**
 * 写入某 photoKey 的尺寸缓存（epoch 毫秒）。
 * 26.09.14：options.verify = true 时写入本版校验号（表示该尺寸已被运行期探测复核）；
 * 不传该选项时**保留既有条目的 v**（一次普通写入不会把已校验标记降级）。
 */
export function setSize(
	key: string,
	w: number,
	h: number,
	options?: { verify?: boolean },
): void {
	if (!key) return;
	const ww = Math.round(w);
	const hh = Math.round(h);
	if (!(ww > 0 && hh > 0)) return;
	ensureSchema();
	// 26.09.14：先读旧值再写（否则会被本次写入覆盖，v 丢失）
	const prev = options?.verify === true ? null : getSize(key);
	const entry: CachedPhotoSize = { w: ww, h: hh, t: now() };
	if (options?.verify === true) {
		entry.v = PHOTO_CACHE_VERIFY_SCHEMA;
	} else if (prev && typeof prev.v === "string") {
		entry.v = prev.v;
	}
	writeRaw(PHOTO_CACHE_PREFIX + key, JSON.stringify(entry));
	amortizedPrune();
}

let writeCount = 0;

/** 摊销式修剪：每约 25 次写入执行一次完整修剪，避免每次 O(n) 扫描。 */
function amortizedPrune(): void {
	writeCount++;
	if (writeCount % 25 !== 0) return;
	prune();
}

/** 取所有前缀条目（key → entry），供 prune 使用。 */
function collectEntries(): Array<{ fullKey: string; entry: CachedPhotoSize }> {
	const store = storage;
	if (store) {
		const out: Array<{ fullKey: string; entry: CachedPhotoSize }> = [];
		for (const fullKey of prefixKeys(store)) {
			const raw = store.getItem(fullKey);
			if (raw === null) continue;
			const entry = parseEntry(raw);
			if (entry) out.push({ fullKey, entry });
		}
		return out;
	}
	const out: Array<{ fullKey: string; entry: CachedPhotoSize }> = [];
	for (const [fullKey, raw] of memoryStore) {
		if (!fullKey.startsWith(PHOTO_CACHE_PREFIX)) continue;
		const entry = parseEntry(raw);
		if (entry) out.push({ fullKey, entry });
	}
	return out;
}

/**
 * 修剪：
 * 1. 清理过期条目（t 距今 > 90 天）；
 * 2. 若剩余 > 800 条，按 t 升序清掉最旧 20%。
 * 只操作本前缀的键。
 */
export function prune(): void {
	const entries = collectEntries();
	if (entries.length === 0) return;

	const nowMs = now();
	entries.sort((a, b) => a.entry.t - b.entry.t);

	// 1) 过期清理
	let expired = 0;
	for (const item of entries) {
		if (nowMs - item.entry.t > PHOTO_CACHE_TTL_MS) {
			removeRaw(item.fullKey);
			expired++;
		}
	}
	if (expired > 0) entries.splice(0, expired);

	// 2) 超上限清最旧 20%
	if (entries.length > PHOTO_CACHE_MAX_KEYS) {
		const drop = Math.ceil(entries.length * 0.2);
		for (let i = 0; i < drop && i < entries.length; i++) {
			removeRaw(entries[i].fullKey);
		}
	}
}

/**
 * sweepByKeys：只清理本前缀下「损坏条目」的维护任务，7 天节流。
 * （在 getSize 已有防御的前提下，用于彻底扫掉异常数据。）
 */
export function sweepByKeys(): void {
	if (storage) {
		try {
			const lastRaw = storage.getItem(`${PHOTO_CACHE_PREFIX}sweepAt`);
			const last = lastRaw ? Number(lastRaw) : 0;
			if (last && now() - last < PHOTO_CACHE_SWEEP_INTERVAL_MS) return;
			storage.setItem(`${PHOTO_CACHE_PREFIX}sweepAt`, String(now()));
		} catch {
			/* 无法节流标记则本次仍执行一次 */
		}
	}

	const store = storage;
	if (store) {
		for (const fullKey of prefixKeys(store)) {
			const raw = store.getItem(fullKey);
			if (raw === null) continue;
			if (fullKey === PHOTO_CACHE_SCHEMA_KEY) continue;
			if (fullKey.endsWith("sweepAt")) continue;
			if (parseEntry(raw) === null) {
				removeRaw(fullKey);
			}
		}
		return;
	}
	// 内存降级：同样只清损坏项
	for (const [fullKey, raw] of memoryStore) {
		if (!fullKey.startsWith(PHOTO_CACHE_PREFIX)) continue;
		if (fullKey === PHOTO_CACHE_SCHEMA_KEY) continue;
		if (fullKey.endsWith("sweepAt")) continue;
		if (parseEntry(raw) === null) {
			memoryStore.delete(fullKey);
		}
	}
}

/** 供测试/诊断：本前缀下当前缓存条数（不含 schema / sweepAt 元数据键）。 */
export function debugCount(): number {
	if (storage) {
		let n = 0;
		for (const fullKey of prefixKeys(storage)) {
			if (
				fullKey === PHOTO_CACHE_SCHEMA_KEY ||
				fullKey.endsWith("sweepAt")
			)
				continue;
			n++;
		}
		return n;
	}
	let n = 0;
	for (const fullKey of memoryStore.keys()) {
		if (fullKey.startsWith(PHOTO_CACHE_PREFIX)) {
			if (
				fullKey === PHOTO_CACHE_SCHEMA_KEY ||
				fullKey.endsWith("sweepAt")
			)
				continue;
			n++;
		}
	}
	return n;
}

/** 仅供 Node 测试环境重置内部状态。 */
export function _resetForTest(): void {
	storage = detectStorage();
	memoryStore.clear();
	writeCount = 0;
}
