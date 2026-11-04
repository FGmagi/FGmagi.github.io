/**
 * 动效偏好统一判定（26.11.03「动效整体修缮」批 1）
 *
 * 全站 JS 侧动效（浮层面板、打字机、横幅轮播、波浪、滚动揭示…）都从这里读，
 * 避免各自判断 `prefers-reduced-motion` 时口径不一（此前只有 CSS 有零散兜底）。
 *
 * 判定为「减少动效」的两种来源（任一命中即生效）：
 *   · 系统偏好 `prefers-reduced-motion: reduce`；
 *   · 用户级开关：`<html class="reduce-motion">`（显示设置面板写入，见 motion.css）。
 */

const REDUCE_CLASS = "reduce-motion";
const MEDIA_QUERY = "(prefers-reduced-motion: reduce)";

/** 当前是否应当减少动效 */
export function prefersReducedMotion(): boolean {
	if (typeof window === "undefined" || typeof document === "undefined") {
		return false;
	}
	if (document.documentElement.classList.contains(REDUCE_CLASS)) return true;
	if (typeof window.matchMedia !== "function") return false;
	try {
		return window.matchMedia(MEDIA_QUERY).matches;
	} catch {
		return false;
	}
}

/**
 * 订阅「减少动效」状态变化（系统偏好变化 + 用户开关切换）。
 * @returns 取消订阅函数
 */
export function onReducedMotionChange(
	callback: (reduced: boolean) => void,
): () => void {
	if (typeof window === "undefined" || typeof document === "undefined") {
		return () => {};
	}

	const emit = () => callback(prefersReducedMotion());

	let media: MediaQueryList | null = null;
	if (typeof window.matchMedia === "function") {
		try {
			media = window.matchMedia(MEDIA_QUERY);
			// 旧 Safari 只有 addListener；用可选调用同时兼容两种
			(media as any).addEventListener?.("change", emit);
			if (!(media as any).addEventListener) {
				(media as any).addListener?.(emit);
			}
		} catch {
			media = null;
		}
	}

	// 用户级开关切换时由写入方派发，避免轮询
	document.addEventListener("reduce-motion-change", emit);

	return () => {
		(media as any)?.removeEventListener?.("change", emit);
		if (media && !(media as any).addEventListener) {
			(media as any).removeListener?.(emit);
		}
		document.removeEventListener("reduce-motion-change", emit);
	};
}
