/**
 * 相册照片「构建期尺寸」工具（仅 SSR / build / Node 脚本使用；严禁被客户端模块引用）。
 *
 * 尺寸决策四级（全部发生在 build/SSR，零运行时开销）：
 *   ① Photo.width/height 显式值
 *   ② 本 build memoMap[photoKey]（memo 汇总）
 *   ③ 本地原档 sharp.metadata（rawFileForSrc 命中；sharp 已在 dependencies）
 *   ④ 未知 → 不填（交运行期探测 / 校正）
 *
 * 输出两种消费物：
 *   - enrichAlbums：把已知尺寸回填到相册照片对象（供相册详情页 SSR 内联）；
 *   - buildManifestJson：产出全局尺寸 manifest（schema 2）。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import sharp from "sharp";
import type { AlbumGroup, Photo } from "../types/album.js";
import { photoKey } from "./photo-identity.js";

/** jsDelivr GitHub 直链仓库常量（本地原档与线上 CDN 同源同 commit） */
export const GITHUB_OWNER = "FGmagi";
export const GITHUB_REPO = "FGmagi.github.io";

export interface ManifestPhoto {
	key: string;
	src: string;
	w?: number;
	h?: number;
}

export interface ManifestAlbum {
	id: string;
	photos: ManifestPhoto[];
}

export interface PhotoMetaManifest {
	schema: 2;
	builtAt: string;
	albums: ManifestAlbum[];
}

export type PhotoDim = { w: number; h: number };

/**
 * 本 build 的按 photoKey 汇总 memo（②级）。进程级共享：
 * 静态构建同一进程会多次 scanAlbums + enrich（列表页 / 详情页 / manifest），
 * 相同 photoKey 的 sharp 结果不必重复读取。
 */
const memoByKey = new Map<string, PhotoDim>();

/** 本地原档路径 → sharp 尺寸缓存（跨相册同文件去重）。 */
const dimByRawPath = new Map<string, PhotoDim>();

/** 规范化相对路径段（逐段解码、拒绝空/./.. 与反斜杠）。 */
function cleanSegments(parts: string[]): string[] {
	const out: string[] = [];
	for (const raw of parts) {
		if (!raw || raw === "." || raw === ".." || raw.includes("\\")) continue;
		let seg = raw;
		try {
			seg = decodeURIComponent(raw);
		} catch {
			/* 保留原值 */
		}
		if (seg) out.push(seg);
	}
	return out;
}

/**
 * 外链 src → 本地原档文件系统路径（命中返回绝对路径，否则 null）。
 * 支持两类：
 *  1) https://cdn.jsdelivr.net/gh/<owner>/<repo>[@<branch>]/<rel>（owner/repo 匹配仓库常量）
 *     → path.join(process.cwd(), ...rel 逐段 decode 后的段)
 *  2) /images/<album>/<file>（本地相册网页路径）→ path.join(process.cwd(), 'public', ...)
 */
export function rawFileForSrc(src: string): string | null {
	const trimmed = String(src ?? "").trim();
	if (!trimmed) return null;

	if (/^https:\/\/cdn\.jsdelivr\.net\/gh\//i.test(trimmed)) {
		const pathOnly = trimmed.split(/[?#]/)[0];
		const parts = pathOnly.split("/"); // ['https:','','cdn.jsdelivr.net','gh',owner,repoSpec,rel...]
		if (parts.length < 6 || parts[3] !== "gh") return null;
		const owner = parts[4];
		const repoSpec = parts[5];
		if (!owner || !repoSpec) return null;
		if (owner !== GITHUB_OWNER) return null;
		const at = repoSpec.indexOf("@");
		const repo = at === -1 ? repoSpec : repoSpec.slice(0, at);
		if (repo !== GITHUB_REPO) return null;
		const segs = cleanSegments(parts.slice(6));
		if (segs.length === 0) return null;
		const abs = path.join(process.cwd(), ...segs);
		return fs.existsSync(abs) ? abs : null;
	}

	if (trimmed.startsWith("/")) {
		// 本地相册网页路径 → public/ 下原档
		const rel = trimmed.replace(/^\/+/, "").split("/").filter(Boolean);
		if (rel.length < 2) return null; // 至少 /目录/文件
		const abs = path.join(process.cwd(), "public", ...rel);
		return fs.existsSync(abs) ? abs : null;
	}

	return null;
}

async function sharpDim(filePath: string): Promise<PhotoDim | undefined> {
	const cached = dimByRawPath.get(filePath);
	if (cached) return cached;
	try {
		const meta = await sharp(filePath).metadata();
		const w = meta.width;
		const h = meta.height;
		if (typeof w === "number" && typeof h === "number" && w > 0 && h > 0) {
			const dim = { w, h };
			dimByRawPath.set(filePath, dim);
			return dim;
		}
	} catch {
		/* 读取失败 → undefined */
	}
	return undefined;
}

/**
 * 四级尺寸解析：把 photo.width/height 回填为已知值。
 * 解析成功返回 {w,h}，仍未知返回 undefined（交由运行期）。
 */
export async function resolveKnownSize(
	albumId: string,
	photo: Photo,
	memo?: Map<string, PhotoDim>,
): Promise<PhotoDim | undefined> {
	// ① 显式值
	if (
		typeof photo.width === "number" &&
		typeof photo.height === "number" &&
		photo.width > 0 &&
		photo.height > 0
	) {
		return { w: photo.width, h: photo.height };
	}

	const key = photoKey(albumId, photo.src);
	const memoMap = memo ?? memoByKey;

	// ② 本 build memo 汇总
	const fromMemo = memoMap.get(key);
	if (fromMemo) {
		photo.width = fromMemo.w;
		photo.height = fromMemo.h;
		return fromMemo;
	}

	// ③ 本地原档 sharp.metadata
	const rawPath = rawFileForSrc(photo.src);
	if (rawPath) {
		const dim = await sharpDim(rawPath);
		if (dim) {
			photo.width = dim.w;
			photo.height = dim.h;
			memoMap.set(key, dim);
			return dim;
		}
	}

	// ④ 未知
	return undefined;
}

/**
 * 回填整组相册的已知尺寸（就地修改 photos，返回同一数组便于链式）。
 */
export async function enrichAlbums(
	albums: AlbumGroup[],
	memo?: Map<string, PhotoDim>,
): Promise<AlbumGroup[]> {
	for (const album of albums) {
		for (const photo of album.photos) {
			await resolveKnownSize(album.id, photo, memo);
		}
	}
	return albums;
}

/**
 * 全局尺寸 manifest（schema 2，无冗余 flat map；w/h 缺失 = 构建期未知）。
 * 会先做一次 enrich（与相册页同一套四级决策）。
 */
export async function buildManifestJson(
	albums: AlbumGroup[],
	memo?: Map<string, PhotoDim>,
): Promise<PhotoMetaManifest> {
	await enrichAlbums(albums, memo);
	return {
		schema: 2,
		builtAt: new Date().toISOString(),
		albums: albums.map((album) => ({
			id: album.id,
			photos: album.photos.map((photo) => {
				const rec: ManifestPhoto = {
					key: photoKey(album.id, photo.src),
					src: photo.src,
				};
				if (
					typeof photo.width === "number" &&
					typeof photo.height === "number"
				) {
					rec.w = photo.width;
					rec.h = photo.height;
				}
				return rec;
			}),
		})),
	};
}
