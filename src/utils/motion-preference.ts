

/** 当前是否应当减少动效 */
export function prefersReducedMotion(): boolean {
	if (typeof window === "undefined" || typeof document === "undefined") {
		return false;
	}
	return document.documentElement.dataset.reducedMotion === "true";
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

	const observer = new MutationObserver(emit);
	observer.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["data-reduced-motion"],
	});

	// 用户级开关切换时由写入方派发，避免轮询
	document.addEventListener("reduce-motion-change", emit);

	return () => {
		observer.disconnect();
		document.removeEventListener("reduce-motion-change", emit);
	};
}
