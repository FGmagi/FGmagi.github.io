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
