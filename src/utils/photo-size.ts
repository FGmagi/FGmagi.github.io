/**
 * 相册图片「尺寸探测」工具（双端可用）。
 *
 * - `parseImageSizeFromBytes`：从图片文件头字节解析宽高（JPEG SOF0/2 / PNG IHDR / GIF /
 *   WebP VP8/VP8L/VP8X / AVIF ispe）。绝不依赖完整文件，仅需头部一段字节。
 * - `fetchHeaderSize`：对远程图片用 HTTP Range「字节范围读文件头」的方式拿头部字节，
 *   按需放大探测窗口、设封顶；服务器无视 Range 时只读首块即 cancel 流，绝不全量下载；
 *   失败返回 null（调用方默认宽高比占位）。
 *
 * 不含任何 node / DOM 专属依赖，可被客户端与 Node 同时 import。
 */

export interface PhotoDim {
	w: number;
	h: number;
}

const BE32 = (b: Uint8Array, o: number): number =>
	((b[o] & 0xff) << 24) |
	((b[o + 1] & 0xff) << 16) |
	((b[o + 2] & 0xff) << 8) |
	(b[o + 3] & 0xff);
const BE16 = (b: Uint8Array, o: number): number =>
	((b[o] & 0xff) << 8) | (b[o + 1] & 0xff);
const LE16 = (b: Uint8Array, o: number): number =>
	(b[o] & 0xff) | ((b[o + 1] & 0xff) << 8);
const LE24 = (b: Uint8Array, o: number): number =>
	(b[o] & 0xff) | ((b[o + 1] & 0xff) << 8) | ((b[o + 2] & 0xff) << 16);
const LE32 = (b: Uint8Array, o: number): number =>
	(b[o] & 0xff) |
	((b[o + 1] & 0xff) << 8) |
	((b[o + 2] & 0xff) << 16) |
	((b[o + 3] & 0xff) << 24);

function ascii(b: Uint8Array, o: number, len: number): string {
	let s = "";
	for (let i = 0; i < len; i++) {
		const c = b[o + i];
		if (c === undefined) break;
		s += String.fromCharCode(c);
	}
	return s;
}

const valid = (dim: PhotoDim): boolean =>
	Number.isFinite(dim.w) &&
	Number.isFinite(dim.h) &&
	dim.w > 0 &&
	dim.h > 0 &&
	dim.w <= 100000 &&
	dim.h <= 100000;

/** JPEG：找 SOF0/SOF1/SOF2（或其它 SOFn，跳过 DHT/DAC/JPG），读高/宽。 */
export function parseJpegSize(b: Uint8Array): PhotoDim | null {
	if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
	let i = 2;
	const end = b.length - 1;
	while (i < end) {
		if (b[i] !== 0xff) {
			i++;
			continue;
		}
		const marker = b[i + 1];
		// 跳过填充 FF
		if (marker === 0xff) {
			i++;
			continue;
		}
		// SOI / RSTn / TEM
		if (
			(marker >= 0xd0 && marker <= 0xd7) ||
			marker === 0xd8 ||
			marker === 0x01
		) {
			i += 2;
			continue;
		}
		// EOI / SOS：走到数据段，不再有 SOF
		if (marker === 0xd9 || marker === 0xda) return null;
		if (
			marker >= 0xc0 &&
			marker <= 0xcf &&
			marker !== 0xc4 &&
			marker !== 0xc8 &&
			marker !== 0xcc
		) {
			if (i + 9 >= b.length) return null;
			const h = BE16(b, i + 5);
			const w = BE16(b, i + 7);
			const dim = { w, h };
			return valid(dim) ? dim : null;
		}
		if (i + 4 >= b.length) return null;
		const segLen = BE16(b, i + 2);
		if (segLen < 2) return null;
		i += 2 + segLen;
	}
	return null;
}

/** PNG：IHDR 块（签名后第 16 字节起 8 字节大端宽高）。 */
export function parsePngSize(b: Uint8Array): PhotoDim | null {
	if (
		b.length < 24 ||
		b[0] !== 0x89 ||
		b[1] !== 0x50 ||
		b[2] !== 0x4e ||
		b[3] !== 0x47
	) {
		return null;
	}
	if (ascii(b, 12, 4) !== "IHDR") return null;
	const w = (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19];
	const h = (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23];
	const dim = { w, h };
	return valid(dim) ? dim : null;
}

/** GIF：GIF87a/89a 逻辑屏幕宽高（小端）。 */
export function parseGifSize(b: Uint8Array): PhotoDim | null {
	if (b.length < 10) return null;
	const sig = ascii(b, 0, 6);
	if (sig !== "GIF87a" && sig !== "GIF89a") return null;
	const dim = { w: LE16(b, 6), h: LE16(b, 8) };
	return valid(dim) ? dim : null;
}

/** WebP：RIFF…WEBP，按 chunk 定位 VP8 / VP8L / VP8X。 */
export function parseWebpSize(b: Uint8Array): PhotoDim | null {
	if (b.length < 30) return null;
	if (ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP") return null;
	// 解析 chunk（可能紧跟多个 chunk，VP8X 在前）
	let o = 12;
	const end = Math.min(b.length, 1024 * 1024);
	while (o + 8 <= end) {
		const fourcc = ascii(b, o, 4);
		const size = LE32(b, o + 4);
		const data = o + 8;
		if (size > end - data) return null; // 头不完整
		if (fourcc === "VP8 ") {
			// lossy：VP8 块数据 = 3 字节 frame tag + 3 字节 start code(0x9d 0x01 0x2a)
			// + 2 字节宽(LE) + 2 字节高(LE)。start code 缺失时退化按 data+3 读取。
			if (data + 8 > b.length) return null;
			const hasStartCode =
				b[data + 3] === 0x9d &&
				b[data + 4] === 0x01 &&
				b[data + 5] === 0x2a;
			const o = hasStartCode ? data + 6 : data + 3;
			const w = LE16(b, o) & 0x3fff;
			const h = LE16(b, o + 2) & 0x3fff;
			const dim = { w, h };
			return valid(dim) ? dim : null;
		}
		if (fourcc === "VP8L") {
			// lossless：0x2f 后 4 字节打包宽高（各 14 bit，-1 存储）
			if (data + 5 > b.length || b[data] !== 0x2f) return null;
			const bits = LE32(b, data + 1);
			const dim = {
				w: (bits & 0x3fff) + 1,
				h: ((bits >> 14) & 0x3fff) + 1,
			};
			return valid(dim) ? dim : null;
		}
		if (fourcc === "VP8X") {
			// 扩展：1 flags + 3 reserved + 3 字节宽-1 + 3 字节高-1
			if (data + 10 > b.length) return null;
			const dim = {
				w: LE24(b, data + 4) + 1,
				h: LE24(b, data + 7) + 1,
			};
			return valid(dim) ? dim : null;
		}
		if (fourcc === "ALPH" || fourcc === "ANIM" || fourcc === "ANMF") {
			o = data + size + (size & 1); // chunks 2 字节对齐
			continue;
		}
		return null;
	}
	return null;
}

/**
 * ISO BMFF（AVIF / HEIC）解析：遍历 box 树找 `ispe`（含宽高）。
 * AVIF 的 ispe 可能嵌得较深（meta > iprp > ipco > ispe），本实现做有限深度递归。
 */
export function parseAvifSize(b: Uint8Array): PhotoDim | null {
	const dim = scanIspe(b, 0, b.length, 0);
	return dim && valid(dim) ? dim : null;
}

/** 在 [start, end) 内按 box 头遍历；meta 需跳过 4 字节 version/flags。 */
function scanIspe(
	b: Uint8Array,
	start: number,
	end: number,
	depth: number,
): PhotoDim | null {
	if (depth > 5 || start < 0 || end > b.length || start + 8 > end)
		return null;
	let o = start;
	while (o + 8 <= end) {
		let size = BE32(b, o);
		const type = ascii(b, o + 4, 4);
		let hdrLen = 8;
		if (size === 1) {
			// largesize（64 位）
			if (o + 16 > end) return null;
			const hi = BE32(b, o + 8);
			const lo = BE32(b, o + 12);
			size = hi * 4294967296 + lo;
			hdrLen = 16;
		} else if (size === 0) {
			size = end - o; // box 延伸至文件末尾
		}
		if (size < hdrLen) return null;
		const data = o + hdrLen;
		const boxEnd = Math.min(end, o + size);
		if (type === "ispe") {
			// full box: 4 字节 version/flags + 4 字节宽 + 4 字节高
			if (data + 12 > boxEnd) return null;
			const w = BE32(b, data + 4);
			const h = BE32(b, data + 8);
			const dim = { w, h };
			return valid(dim) ? dim : null;
		}
		if (type === "meta") {
			if (boxEnd - data < 4) return null;
			const inner = scanIspe(b, data + 4, boxEnd, depth + 1);
			if (inner) return inner;
		} else if (
			type === "iprp" ||
			type === "ipco" ||
			type === "moov" ||
			type === "trak" ||
			type === "mdia" ||
			type === "minf" ||
			type === "stbl"
		) {
			const inner = scanIspe(b, data, boxEnd, depth + 1);
			if (inner) return inner;
		}
		o = boxEnd;
	}
	return null;
}

/** 自动识别并解析常见格式的图片头字节。 */
export function parseImageSizeFromBytes(bytes: Uint8Array): PhotoDim | null {
	if (!bytes || bytes.length < 12) return null;
	// PNG / GIF / JPEG / WebP / AVIF(ISO BMFF) 快速判定
	if (bytes[0] === 0x89 && bytes[1] === 0x50) return parsePngSize(bytes);
	if (ascii(bytes, 0, 3) === "GIF") return parseGifSize(bytes);
	if (bytes[0] === 0xff && bytes[1] === 0xd8) return parseJpegSize(bytes);
	if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP")
		return parseWebpSize(bytes);
	// ISO BMFF（AVIF/HEIC）：box 头 + ftyp 品牌
	if (ascii(bytes, 4, 4) === "ftyp") {
		const avif = parseAvifSize(bytes);
		if (avif) return avif;
	}
	return null;
}

export interface FetchHeaderOptions {
	/** 外部中止信号（页面离开/组件卸载时中止） */
	signal?: AbortSignal;
	/** 探测窗口上限（字节），默认 1 MiB */
	maxBytes?: number;
	/** 单次请求超时（毫秒） */
	timeoutMs?: number;
}

/** 依次尝试的探测窗口（字节）。起点 64 KiB，AVIF ispe 可能更深则按需放大。 */
const PROBE_WINDOWS = [65536, 262144, 1048576];

/**
 * 远程图片尺寸探测：Range 读文件头，绝不全量下载。
 * 返回 null 表示探测失败（网络 / 服务器不支持 / 格式不支持 / 头不完整）。
 */
export async function fetchHeaderSize(
	url: string,
	opts: FetchHeaderOptions = {},
): Promise<PhotoDim | null> {
	if (typeof fetch !== "function") return null;
	if (!/^https?:\/\//i.test(url)) return null;
	const maxBytes = opts.maxBytes ?? PROBE_WINDOWS[PROBE_WINDOWS.length - 1];
	const windows = PROBE_WINDOWS.filter((n) => n <= maxBytes);
	if (windows.length === 0) windows.push(maxBytes);

	for (const size of windows) {
		const got = await probeRange(url, size, opts);
		if (got === "unsupported") return null; // 服务器无法按需返回
		if (got) {
			const dim = parseImageSizeFromBytes(got);
			if (dim) return dim;
		}
	}
	return null;
}

/**
 * 对单个 url 发 Range 请求读取前 `size` 字节。
 * 返回值：
 * - null          —— 网络错误 / 超时 / 中止 / 空体（可换更大窗口重试）
 * - "unsupported" —— 服务器忽略 Range 返回了 200 全量但无法提供首块（不再重试）
 * - Uint8Array    —— 读到的头部字节（可能短于 size，如文件更小）
 */
async function probeRange(
	url: string,
	size: number,
	opts: FetchHeaderOptions,
): Promise<Uint8Array | "unsupported" | null> {
	const controller = new AbortController();
	const timeoutMs = opts.timeoutMs ?? 15000;
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	const onAbort = () => controller.abort();
	const external = opts.signal;
	if (external) {
		if (external.aborted) {
			clearTimeout(timer);
			return null;
		}
		external.addEventListener("abort", onAbort, { once: true });
	}
	try {
		const res = await fetch(url, {
			headers: { Range: `bytes=0-${size - 1}` },
			signal: controller.signal,
		});
		if (!res) return null;
		// 200 = 服务器无视 Range（全量响应）；206 = 按需。两者都只读首块即 cancel。
		if (res.status !== 200 && res.status !== 206) return null;
		if (!res.body || typeof res.body.getReader !== "function") return null;

		const reader = res.body.getReader();
		const chunks: Uint8Array[] = [];
		let total = 0;
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				if (value) {
					chunks.push(value);
					total += value.length;
				}
				// 只保留需要的前 size 字节：已足够即停止并 cancel 流
				if (total >= size) break;
			}
		} catch (e) {
			if ((e as Error)?.name === "AbortError") return null;
			throw e;
		} finally {
			// 绝不继续下载剩余内容
			reader.cancel().catch(() => {
				/* 忽略 cancel 失败 */
			});
		}
		if (total === 0) return null;
		const out = new Uint8Array(Math.min(total, size));
		let written = 0;
		for (const c of chunks) {
			const need = Math.min(c.length, out.length - written);
			if (need <= 0) break;
			out.set(c.subarray(0, need), written);
			written += need;
			if (written >= out.length) break;
		}
		return out.subarray(0, written);
	} catch (e) {
		const err = e as Error | null;
		if (err && err.name === "AbortError") {
			// 外部 signal 中止与内部超时都算“失败”
			return null;
		}
		return null;
	} finally {
		clearTimeout(timer);
		if (external) external.removeEventListener("abort", onAbort);
	}
}
