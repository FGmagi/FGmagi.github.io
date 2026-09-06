/**
 * 相册照片「身份键」工具（双端可用：浏览器 / Node SSR / 构建脚本）。
 * 全链路唯一身份 = photoKey(albumId, src) = `${albumId}/${filenameFromSrc(src)}`。
 * 不 import 任何 node / 浏览器专属模块，可被客户端与服务端安全引用。
 */

/**
 * 从照片 src 中取出“文件名”：
 * 去 `?query`/`#hash` → 按 `/` 分段取末段非空 → decodeURIComponent 一次（失败保留原串）。
 * 保留扩展名、保留原始大小写（CDN 大小写敏感，不做小写折叠）。
 */
export function filenameFromSrc(src: string): string {
	const clean = String(src ?? "").split(/[?#]/)[0];
	const seg = clean.split("/").filter(Boolean).pop() || "";
	if (!seg) return "";
	try {
		return decodeURIComponent(seg);
	} catch {
		return seg;
	}
}

/**
 * 复合身份键：`albumId + "/" + filenameFromSrc(src)`。
 * albumId 经 toSafeSegment 清洗后不含 "/"，故分隔无歧义。
 */
export function photoKey(albumId: string, src: string): string {
	return `${albumId}/${filenameFromSrc(src)}`;
}

/** 身份键内的分隔符（无歧义前提见 photoKey 注释） */
export const PHOTO_KEY_SEP = "/";
