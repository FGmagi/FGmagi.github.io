import sitemap from "@astrojs/sitemap";
import svelte, { vitePreprocess } from "@astrojs/svelte";
import tailwind from "@astrojs/tailwind";
import { pluginCollapsibleSections } from "@expressive-code/plugin-collapsible-sections";
import { pluginLineNumbers } from "@expressive-code/plugin-line-numbers";
import swup from "@swup/astro";
import { defineConfig } from "astro/config";
import expressiveCode from "astro-expressive-code";
import icon from "astro-icon";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeComponents from "rehype-components";
import rehypeKatex from "rehype-katex";
import rehypeSlug from "rehype-slug";
import remarkDirective from "remark-directive";
import remarkGithubAdmonitionsToDirectives from "remark-github-admonitions-to-directives";
import remarkMath from "remark-math";
import remarkSectionize from "remark-sectionize";
import { siteConfig } from "./src/config.ts";
import { pluginCustomCopyButton } from "./src/plugins/expressive-code/custom-copy-button.js";
import { pluginLanguageBadge } from "./src/plugins/expressive-code/language-badge.ts";
import { AdmonitionComponent } from "./src/plugins/rehype-component-admonition.mjs";
import { GithubCardComponent } from "./src/plugins/rehype-component-github-card.mjs";
import { rehypeMermaid } from "./src/plugins/rehype-mermaid.mjs";
import { rehypeWrapTable } from "./src/plugins/rehype-wrap-table.mjs";
import { parseDirectiveNode } from "./src/plugins/remark-directive-rehype.js";
import { remarkMermaid } from "./src/plugins/remark-mermaid.js";
import { remarkContent } from "./src/plugins/remark-content.mjs";
import { remarkRelativeMedia } from "./src/plugins/remark-relative-media.mjs";
import { rehypeImageWidth } from "./src/plugins/rehype-image-width.mjs";
import { rehypeResponsiveMedia } from "./src/plugins/rehype-responsive-media.mjs";

function devPhotoMetaManifest() {
	const TTL_MS = 45 * 1000; // 内存缓存 45s，避免每次刷新都跑一次 18~24s 的扫描
	/** @type {{ at: number; body: string } | null} */
	let cache = null;
	/** @type {Promise<string> | null} */
	let inflight = null;

	return {
		name: "dev-photo-meta-manifest",
		apply: "serve",
		configureServer(server) {
			// 若 config 本身是经 Vite SSR 加载的（Node 不能直接跑 TS 时的回退路径），
			// 配置期那次 SSR module runner 可能已随其临时 server 关闭，此时退回 dev server 的 ssrLoadModule。
			const loadModules = async () => {
				try {
					const [scanner, meta] = await Promise.all([
						import("./src/utils/album-scanner.ts"),
						import("./src/utils/photo-meta.ts"),
					]);
					return { scanner, meta };
				} catch (e) {
					console.warn(
						"[photo-meta:dev] 动态 import 失败，回退 server.ssrLoadModule：",
						e instanceof Error ? e.message : e,
					);
					return {
						scanner: await server.ssrLoadModule(
							"/src/utils/album-scanner.ts",
						),
						meta: await server.ssrLoadModule(
							"/src/utils/photo-meta.ts",
						),
					};
				}
			};

			server.middlewares.use(async (req, res, next) => {
				const url = req.url || "";
				const qIndex = url.indexOf("?");
				const pathname = qIndex === -1 ? url : url.slice(0, qIndex);
				if (pathname !== "/data/photo-meta.json") return next();
				if (req.method && req.method !== "GET") return next();

				// 与端点一致的响应头；返回体同样是 { schema, builtAt, albums }
				const sendJson = (status, body) => {
					res.statusCode = status;
					res.setHeader(
						"Content-Type",
						"application/json; charset=utf-8",
					);
					res.setHeader("Cache-Control", "no-cache");
					res.end(body);
				};

				const query = new URLSearchParams(
					qIndex === -1 ? "" : url.slice(qIndex + 1),
				);
				const force = query.get("refresh") === "1"; // ?refresh=1 强制重算

				try {
					if (!force && cache && Date.now() - cache.at < TTL_MS) {
						sendJson(200, cache.body);
						return;
					}
					if (!inflight) {
						// 并发请求合并到同一次扫描（扫描很慢，不能各算各的）
						inflight = (async () => {
							const { scanner, meta } = await loadModules();
							const albums = await scanner.scanAlbums();
							return JSON.stringify(
								await meta.buildManifestJson(albums),
							);
						})();
						const pending = inflight;
						pending
							.finally(() => {
								// 成功/失败都清空，失败后下次请求可重试
								if (inflight === pending) inflight = null;
							})
							.catch(() => {
								/* 失败由下方 catch 统一处理，这里只防 unhandledRejection */
							});
					}
					const body = await inflight;
					cache = { at: Date.now(), body };
					sendJson(200, body);
				} catch (e) {
					const msg = e instanceof Error ? e.message : String(e);
					console.warn("[photo-meta:dev] manifest 生成失败：", msg);
					sendJson(
						500,
						JSON.stringify({
							schema: 2,
							builtAt: new Date().toISOString(),
							albums: [],
							error: msg,
						}),
					);
				}
			});
		},
	};
}

// https://astro.build/config
export default defineConfig({
	site: siteConfig.siteURL,
	base: "/",
	trailingSlash: "always",

	output: "static",

	integrations: [
		tailwind({
			nesting: true,
		}),
		swup({
			theme: false,
			animationClass: "transition-swup-",
			// 侧栏目录不在 main 内（否则会被 #main-grid 的透明度动画二次相乘），此前 swup 切页不会替换它，
			// 文章页的目录只能等客户端 100ms 后重建（或干脆不存在），表现为「目录没进入预渲染」。
			containers: ["main", "#sidebar-swup-container", "#toc-swup-region"],
			smoothScrolling: false, // 禁用平滑滚动以提升性能，避免与锚点导航冲突
			cache: true,
			preload: true, // swup 默认鼠标悬停预加载
			accessibility: true,
			updateHead: true,
			updateBodyClass: false,
			globalInstance: true,
			// 滚动相关配置优化
			resolveUrl: (url) => url,
			animateHistoryBrowsing: false,
			skipPopStateHandling: (event) => {
				// 跳过锚点链接的处理，让浏览器原生处理
				return (
					event.state &&
					event.state.url &&
					event.state.url.includes("#")
				);
			},
		}),
		icon(),
		expressiveCode({
			themes: ["github-light", "github-dark"],
			plugins: [
				pluginCollapsibleSections(),
				pluginLineNumbers(),
				pluginLanguageBadge(),
				pluginCustomCopyButton(),
			],
			defaultProps: {
				wrap: true,
				overridesByLang: {
					shellsession: { showLineNumbers: false },
					bash: { frame: "code" },
					shell: { frame: "code" },
					sh: { frame: "code" },
					zsh: { frame: "code" },
				},
			},
			styleOverrides: {
				codeBackground: "var(--codeblock-bg)",
				borderRadius: "0.75rem",
				borderColor: "none",
				codeFontSize: "0.875rem",
				codeFontFamily:
					"'JetBrains Mono Variable', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
				codeLineHeight: "1.5rem",
				frames: {
					editorBackground: "var(--codeblock-bg)",
					terminalBackground: "var(--codeblock-bg)",
					terminalTitlebarBackground: "var(--codeblock-bg)",
					editorTabBarBackground: "var(--codeblock-bg)",
					editorActiveTabBackground: "none",
					editorActiveTabIndicatorBottomColor: "var(--primary)",
					editorActiveTabIndicatorTopColor: "none",
					editorTabBarBorderBottomColor: "var(--codeblock-bg)",
					terminalTitlebarBorderBottomColor: "none",
				},
				textMarkers: {
					delHue: 0,
					insHue: 180,
					markHue: 250,
				},
			},
			frames: {
				showCopyToClipboardButton: false,
			},
		}),
		svelte({
			preprocess: vitePreprocess(),
		}),
		sitemap(),
	],
	markdown: {
		remarkPlugins: [
			remarkMath,
			remarkContent,
			remarkRelativeMedia,
			remarkGithubAdmonitionsToDirectives,
			remarkDirective,
			remarkSectionize,
			parseDirectiveNode,
			remarkMermaid,
		],
		rehypePlugins: [
			rehypeKatex,
			rehypeSlug,
			rehypeWrapTable,
			rehypeMermaid,
			rehypeImageWidth,
			rehypeResponsiveMedia,
			[
				rehypeComponents,
				{
					components: {
						github: GithubCardComponent,
						note: (x, y) => AdmonitionComponent(x, y, "note"),
						tip: (x, y) => AdmonitionComponent(x, y, "tip"),
						important: (x, y) =>
							AdmonitionComponent(x, y, "important"),
						caution: (x, y) => AdmonitionComponent(x, y, "caution"),
						warning: (x, y) => AdmonitionComponent(x, y, "warning"),
					},
				},
			],
			[
				rehypeAutolinkHeadings,
				{
					behavior: "append",
					properties: {
						className: ["anchor"],
					},
					content: {
						type: "element",
						tagName: "span",
						properties: {
							className: ["anchor-icon"],
							"data-pagefind-ignore": true,
						},
						children: [{ type: "text", value: "#" }],
					},
				},
			],
		],
	},
	vite: {
		build: {
			// 静态资源处理优化，防止小图片转 base64 导致 HTML 体积过大（可选，根据需要调整）
			assetsInlineLimit: 4096,

			rollupOptions: {
				onwarn(warning, warn) {
					if (
						warning.message.includes(
							"is dynamically imported by",
						) &&
						warning.message.includes(
							"but also statically imported by",
						)
					) {
						return;
					}
					warn(warning);
				},
			},
		},
		plugins: [devPhotoMetaManifest()],
	},
});
