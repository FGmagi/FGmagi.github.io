import { scanAlbums } from "../../utils/album-scanner";
import { buildManifestJson } from "../../utils/photo-meta";

/**
 * 相册全局尺寸 manifest（schema 2）：
 * { schema: 2, builtAt, albums: [{ id, photos: [{ key, src, w?, h? }] }] }
 *
 * - 输出 URL：/data/photo-meta.json（与 design 中 public/data/photo-meta.json 同路径）。
 * - 静态构建：Astro 在 build 期预渲染该 GET → dist/data/photo-meta.json（每次构建自动刷新，
 *   无陈旧 manifest 问题）；dev/preview 由 SSR/静态文件实时提供。
 * - 复用与相册页同一套 scanAlbums + enrich（尺寸四级决策），杜绝重复逻辑。
 */
export async function GET() {
	try {
		const albums = await scanAlbums();
		const manifest = await buildManifestJson(albums);

		// 26.09.14：构建期可见性 —— 直接告知「album-prefetch 还有没有可预取的未知项」，
		// 免得运行期「无候选即无日志」被误判为功能失效。
		const allPhotos = manifest.albums.flatMap((album) => album.photos);
		const total = allPhotos.length;
		const unknown = allPhotos.filter(
			(photo) =>
				!(typeof photo.w === "number" && photo.w > 0) ||
				!(typeof photo.h === "number" && photo.h > 0),
		).length;
		if (unknown === 0) {
			console.warn(
				`[photo-meta] ${total} 张照片尺寸在构建期已全部解析（unknown=0）：album-prefetch 将没有任何"未知项"可预取（当前设计下属正常，不是故障）。`,
			);
		} else {
			console.warn(
				`[photo-meta] 构建期尺寸未知 ${unknown}/${total} 张：album-prefetch 将在非相册页空闲时预取这 ${unknown} 张。`,
			);
		}

		return new Response(JSON.stringify(manifest), {
			headers: {
				"Content-Type": "application/json; charset=utf-8",
				"Cache-Control": "no-cache", // manifest 随部署变化，客户端可按 HTTP 缓存策略短存
			},
		});
	} catch (e) {
		console.error(
			"photo-meta.json 生成失败（网络枚举异常等），返回空 manifest:",
			e instanceof Error ? e.message : e,
		);
		// 兜底：空 manifest，客户端 fetch 方需做 schema/结构守卫
		return new Response(
			JSON.stringify({
				schema: 2,
				builtAt: new Date().toISOString(),
				albums: [],
			}),
			{
				status: 200,
				headers: {
					"Content-Type": "application/json; charset=utf-8",
				},
			},
		);
	}
}
