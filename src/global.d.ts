export {};

declare global {
	interface HTMLElementTagNameMap {
		"table-of-contents": HTMLElement & {
			init?: () => void;
		};
	}

	interface Window {
		// Define swup type directly since @swup/astro doesn't export AstroIntegration
		swup: any;
		pagefind: {
			search: (query: string) => Promise<{
				results: Array<{
					data: () => Promise<SearchResult>;
				}>;
			}>;
		};

		mobileTOCInit?: () => void;
		/** toc-layout.js 暴露的同步重算入口：预渲染帧内量测目录宽度模式与几何 */
		__tocLayoutRecompute?: () => void;
		/** 页面渐变控制器是否已武装首帧预渲染门（body 顶部解析期脚本写入；渐显时置 false） */
		__pagePrerenderArmed?: boolean;
		/** 首帧预渲染门是否已挂过（幂等守卫：swup 换页会重放内联脚本，只有真首载才挂门） */
		__pageTransitionBooted?: boolean;
		/** 页面渐变控制器是否已初始化（幂等守卫；首次打开或刷新为 false） */
		__pageTransitionControllerReady?: boolean;
		/** 渐变动画时长（毫秒，来自 siteConfig.pageTransition；由控制器写回，便于调试查看） */
		__pageFadeOutMs?: number;
		__pageFadeInMs?: number;
		initSemifullScrollDetection?: () => void;
		iconifyLoaded?: boolean;
		__iconifyLoader?: {
			load: () => Promise<void>;
			addToPreloadQueue: (icons: string[]) => void;
			onLoad: (callback: () => void) => void;
			isLoaded: boolean;
		};
		siteConfig: any;
	}
}

interface SearchResult {
	url: string;
	meta: {
		title: string;
	};
	excerpt: string;
	content?: string;
	word_count?: number;
	filters?: Record<string, unknown>;
	anchors?: Array<{
		element: string;
		id: string;
		text: string;
		location: number;
	}>;
	weighted_locations?: Array<{
		weight: number;
		balanced_score: number;
		location: number;
	}>;
	locations?: number[];
	raw_content?: string;
	raw_url?: string;
	sub_results?: SearchResult[];
}

export { SearchResult };
