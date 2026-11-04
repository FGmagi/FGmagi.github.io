/**
 * 卡片「筛选显隐」共享实现（26.11.05）
 *
 * 使用方：首页标签筛选卡（src/components/widget/TagFilter.astro 的内联脚本）、
 *         友链页标签/搜索过滤（public/js/friends-page-handler.js）。
 *
 * 之前这段逻辑在两个文件里各写了一份（display 切换 + 定时器 + 类切换），
 * 现在统一收口到这里，任何一处改行为都不会漏掉另一处。
 *
 * 语义：隐藏 = 短暂下滑 + 透明度递减到 0；显示 = 从下方短暂上滑到原位 + 透明度递增到 1。
 * 配置：src/config.ts 的 cardFilterAnimationConfig → 由 Layout.astro 写入
 *       window.__cardFilterAnim 与 --card-filter-duration / --card-filter-offset。
 * 系统开启「减少动效」时保留淡入淡出、去掉位移（既尊重偏好，又不至于「什么都不动」）。
 *
 * 通过 window.CardFilter 暴露，供非打包脚本（public/js/*）与 Astro 内联脚本共用。
 */
(function () {
	var CLASS_ANIM = "card-filter-anim";
	var CLASS_HIDDEN = "card-filter-hidden";
	var DEFAULT_DURATION = 200;
	var DEFAULT_OFFSET = 10;

	function prefersReducedMotion() {
		try {
			return !!(
				window.matchMedia &&
				window.matchMedia("(prefers-reduced-motion: reduce)").matches
			);
		} catch (e) {
			return false;
		}
	}

	function readConfig() {
		var cfg = window.__cardFilterAnim || {};
		var duration =
			typeof cfg.duration === "number" ? cfg.duration : DEFAULT_DURATION;
		if (!isFinite(duration) || duration < 0) duration = DEFAULT_DURATION;
		var offset = typeof cfg.offset === "number" ? cfg.offset : DEFAULT_OFFSET;
		if (!isFinite(offset)) offset = DEFAULT_OFFSET;
		// 26.11.05：默认不跟随系统「减少动效」（站点要求这个滑动效果），
		// 只有 config 里显式 respectReducedMotion=true 时才把位移收成 0。
		if (cfg.respectReducedMotion === true && prefersReducedMotion()) {
			offset = 0;
		}
		return {
			enable: cfg.enable !== false && duration > 0,
			duration: duration,
			offset: offset,
		};
	}

	function isHidden(card) {
		return (
			card.style.display === "none" || card.classList.contains(CLASS_HIDDEN)
		);
	}

	/** 只在实际要动画时加上过渡类并写入位移变量（避免在无变化时干扰入场动画） */
	function prepare(card, cfg) {
		card.classList.add(CLASS_ANIM);
		// 内联变量兜底：即使全局 --card-filter-offset 缺失也保证位移非零
		card.style.setProperty("--card-filter-offset", cfg.offset + "px");
	}

	function apply(card, visible, options) {
		if (!card) return;
		var opts = options || {};
		var divider = opts.divider || null;
		var animate = opts.animate !== false;
		var cfg = readConfig();

		if (divider) divider.style.display = visible ? "" : "none";

		if (visible) {
			if (!isHidden(card)) return;
			window.clearTimeout(card.__cardFilterHideTimer);
			card.style.display = "";
			if (!animate || !cfg.enable) {
				card.classList.remove(CLASS_HIDDEN);
				return;
			}
			prepare(card, cfg);
			// 起点：下方 + 透明 → 强制样式落定 → 摘类 ⇒ 上滑 + 淡入
			card.classList.add(CLASS_HIDDEN);
			void card.offsetHeight;
			card.classList.remove(CLASS_HIDDEN);
			return;
		}

		if (card.style.display === "none") return;
		if (!animate || !cfg.enable) {
			card.classList.add(CLASS_HIDDEN);
			card.style.display = "none";
			return;
		}
		prepare(card, cfg);
		card.classList.add(CLASS_HIDDEN);
		window.clearTimeout(card.__cardFilterHideTimer);
		card.__cardFilterHideTimer = window.setTimeout(function () {
			// 期间又被显示（类已摘掉）就不再隐藏
			if (card.classList.contains(CLASS_HIDDEN)) {
				card.style.display = "none";
			}
		}, cfg.duration + 20);
	}

	window.CardFilter = {
		apply: apply,
		config: readConfig,
		isHidden: isHidden,
	};
})();
