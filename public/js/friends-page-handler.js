// 友情链接页面处理脚本
// 此脚本作为全局脚本加载，不受 Swup 页面切换影响

(() => {
	console.log("[Friends Global] Script loaded");

	// 使用全局变量存储状态
	if (typeof window.friendsPageState === "undefined") {
		window.friendsPageState = {
			initialized: false,
			eventListeners: [],
			mutationObserver: null,
			copySuccessText: "已复制", // 默认值，会被页面覆盖
		};
	}

	// 初始化函数
	function initFriendsPage() {
		console.log("[Friends Global] initFriendsPage called");

		var searchInput = document.getElementById("friend-search");
		var friendsGrid = document.getElementById("friends-grid");
		var noResults = document.getElementById("no-results");

		// 如果关键元素不存在，直接返回
		if (!searchInput || !friendsGrid || !noResults) {
			return false;
		}

		var tagFilters = document.querySelectorAll(".filter-tag");
		var friendCards = document.querySelectorAll(".friend-card");
		var copyButtons = document.querySelectorAll(".copy-link-btn");

		console.log("[Friends Global] Found elements:", {
			cards: friendCards.length,
			filters: tagFilters.length,
			copyButtons: copyButtons.length,
		});

		// 从页面获取复制成功文本
		var copySuccessTextElement = document.getElementById(
			"friends-copy-success-text",
		);
		if (copySuccessTextElement) {
			window.friendsPageState.copySuccessText =
				copySuccessTextElement.textContent;
		}

		// 清理旧的事件监听器
		if (window.friendsPageState.eventListeners.length > 0) {
			console.log(
				"[Friends Global] Cleaning",
				window.friendsPageState.eventListeners.length,
				"old listeners",
			);
			for (var i = 0; i < window.friendsPageState.eventListeners.length; i++) {
				var listener = window.friendsPageState.eventListeners[i];
				var element = listener[0];
				var type = listener[1];
				var handler = listener[2];
				if (element && element.removeEventListener) {
					element.removeEventListener(type, handler);
				}
			}
			window.friendsPageState.eventListeners = [];
		}

		var currentTag = "all";
		var searchTerm = "";

		// 过滤函数
		function filterFriends() {
			var visibleCount = 0;
			for (var i = 0; i < friendCards.length; i++) {
				var card = friendCards[i];
				var title = (card.getAttribute("data-title") || "").toLowerCase();
				var desc = (card.getAttribute("data-desc") || "").toLowerCase();
				var tags = card.getAttribute("data-tags") || "";

				var matchesSearch =
					!searchTerm ||
					title.indexOf(searchTerm) >= 0 ||
					desc.indexOf(searchTerm) >= 0;
				var matchesTag =
					currentTag === "all" || tags.split(",").indexOf(currentTag) >= 0;

				if (matchesSearch && matchesTag) {
					card.style.display = "";
					visibleCount++;
				} else {
					card.style.display = "none";
				}
			}

			if (visibleCount === 0) {
				noResults.classList.remove("hidden");
				friendsGrid.classList.add("hidden");
			} else {
				noResults.classList.add("hidden");
				friendsGrid.classList.remove("hidden");
			}

			// 26.11.03：筛选会改变可见卡片，显示状态变化后重新判定 desc 滚动链与按钮图标
			updateDynamicLayout();
		}

		// 26.11.03：desc 滚动链控制——只有「电脑端（≥768px）且 desc 内容超过两行、确实能滚动」时，
		// 才给该 desc 加 .friend-desc--scroll-lock（overscroll-behavior: contain），
		// 避免滚到 desc 边界后带动整页；移动端与两行内不滚动的卡片不加，滚动仍按默认传递给页面。
		function updateDescScrollLock() {
			var isDesktop = window.matchMedia
				? window.matchMedia("(min-width: 768px)").matches
				: window.innerWidth >= 768;
			var descs = document.querySelectorAll(".friend-desc");
			for (var d = 0; d < descs.length; d++) {
				var descEl = descs[d];
				// 允许 1px 亚像素误差；卡片被筛选隐藏（display:none）时高度均为 0，同样不锁定
				var scrollable = descEl.scrollHeight - descEl.clientHeight > 1;
				if (isDesktop && scrollable) {
					descEl.classList.add("friend-desc--scroll-lock");
				} else {
					descEl.classList.remove("friend-desc--scroll-lock");
				}
			}
		}

		// 26.11.03：跳转按钮名称过长时自动去掉外链图标——带图标时名称被截断（scrollWidth > clientWidth），
		// 就给按钮加 .is-text-only 隐藏图标，把宽度让给名称（e.g. z-library 的自定义名称「推特发布页」）。
		function updateVisitIconVisibility() {
			var links = document.querySelectorAll(".friend-visit-link");
			for (var k = 0; k < links.length; k++) {
				var link = links[k];
				var label = link.querySelector(".friend-visit-label");
				if (!label) continue;
				// 先还原图标再测量（隐藏状态会改变可用宽度，否则无法退出该状态）
				link.classList.remove("is-text-only");
				// 允许 1px 亚像素误差
				if (label.scrollWidth - label.clientWidth > 1) {
					link.classList.add("is-text-only");
				}
			}
		}

		// 26.11.03：随布局变化（初始化 / 窗口尺寸 / 字体加载 / 筛选）统一刷新两类自适应样式
		function updateDynamicLayout() {
			updateDescScrollLock();
			updateVisitIconVisibility();
		}

		// 搜索功能
		var searchHandler = (e) => {
			searchTerm = e.target.value.toLowerCase();
			filterFriends();
		};
		searchInput.addEventListener("input", searchHandler);
		window.friendsPageState.eventListeners.push([
			searchInput,
			"input",
			searchHandler,
		]);

		// 26.08.31修改，内容为：右键清空友链搜索栏并重置筛选
		var contextMenuHandler = (e) => {
			e.preventDefault();
			searchInput.value = "";
			searchTerm = "";
			filterFriends();
		};
		searchInput.addEventListener("contextmenu", contextMenuHandler);
		window.friendsPageState.eventListeners.push([
			searchInput,
			"contextmenu",
			contextMenuHandler,
		]);

		// 标签筛选
		// 26.11.03：「全部」按钮（模板里 data-tag="all"），用于「再次点击已点亮标签 → 回到全部」
		var allTagButton = null;
		for (var t = 0; t < tagFilters.length; t++) {
			if ((tagFilters[t].getAttribute("data-tag") || "all") === "all") {
				allTagButton = tagFilters[t];
				break;
			}
		}

		for (var i = 0; i < tagFilters.length; i++) {
			((button) => {
				var clickHandler = () => {
					var tag = button.getAttribute("data-tag") || "all";
					// 26.11.03：再次单击已点亮的标签 → 该标签自动熄灭并点亮「全部」（回到不筛选状态）
					var target =
						tag !== "all" && button.classList.contains("active")
							? allTagButton || button
							: button;

					// 更新选中状态
					for (var j = 0; j < tagFilters.length; j++) {
						var btn = tagFilters[j];
						btn.classList.remove("active");
					}
					target.classList.add("active");

					currentTag = target.getAttribute("data-tag") || "all";
					filterFriends();
				};
				button.addEventListener("click", clickHandler);
				window.friendsPageState.eventListeners.push([
					button,
					"click",
					clickHandler,
				]);
			})(tagFilters[i]);
		}

		// 复制链接功能
		for (var i = 0; i < copyButtons.length; i++) {
			((button) => {
				var clickHandler = () => {
					var url = button.getAttribute("data-url");
					if (!url) return;

					if (navigator.clipboard && navigator.clipboard.writeText) {
						navigator.clipboard
							.writeText(url)
							.then(() => {
								var originalHTML = button.innerHTML;
								button.innerHTML =
									'<div class="flex items-center gap-1"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg><span class="text-xs">' +
									window.friendsPageState.copySuccessText +
									"</span></div>";
								button.classList.add("text-green-500");
								setTimeout(() => {
									button.innerHTML = originalHTML;
									button.classList.remove("text-green-500");
								}, 2000);
							})
							.catch((err) => {
								console.error("[Friends Global] Copy failed:", err);
							});
					}
				};
				button.addEventListener("click", clickHandler);
				window.friendsPageState.eventListeners.push([
					button,
					"click",
					clickHandler,
				]);
			})(copyButtons[i]);
		}

		// 26.11.03：初始化自适应样式；窗口尺寸变化（换行列数变化）或字体加载完成（换行位置变化）后复查
		updateDynamicLayout();
		var layoutResizeTimer = null;
		var layoutResizeHandler = () => {
			if (layoutResizeTimer) clearTimeout(layoutResizeTimer);
			layoutResizeTimer = setTimeout(updateDynamicLayout, 150);
		};
		window.addEventListener("resize", layoutResizeHandler);
		window.friendsPageState.eventListeners.push([
			window,
			"resize",
			layoutResizeHandler,
		]);
		if (document.fonts && document.fonts.ready) {
			document.fonts.ready
				.then(updateDynamicLayout)
				.catch(() => {});
		}

		window.friendsPageState.initialized = true;
		console.log(
			"[Friends Global] ✅ Initialization complete with",
			window.friendsPageState.eventListeners.length,
			"listeners",
		);
		return true;
	}

	// 带重试的初始化
	function tryInit(retries) {
		retries = retries || 0;
		if (initFriendsPage()) {
			console.log("[Friends Global] Init succeeded");
			return;
		}
		if (retries < 5) {
			setTimeout(() => {
				tryInit(retries + 1);
			}, 100);
		}
	}

	// MutationObserver 监听 DOM 变化
	function setupMutationObserver() {
		if (window.friendsPageState.mutationObserver) {
			window.friendsPageState.mutationObserver.disconnect();
		}

		window.friendsPageState.mutationObserver = new MutationObserver(
			(mutations) => {
				var shouldInit = false;
				for (var i = 0; i < mutations.length; i++) {
					var mutation = mutations[i];
					if (mutation.addedNodes && mutation.addedNodes.length > 0) {
						for (var j = 0; j < mutation.addedNodes.length; j++) {
							var node = mutation.addedNodes[j];
							if (node.nodeType === 1) {
								if (
									node.id === "friends-grid" ||
									node.id === "friend-search" ||
									(node.querySelector && node.querySelector("#friends-grid"))
								) {
									shouldInit = true;
									break;
								}
							}
						}
					}
					if (shouldInit) break;
				}

				if (shouldInit) {
					console.log("[Friends Global] DOM mutation detected");
					window.friendsPageState.initialized = false;
					setTimeout(() => {
						tryInit();
					}, 50);
				}
			},
		);

		window.friendsPageState.mutationObserver.observe(document.body, {
			childList: true,
			subtree: true,
		});
	}

	// 页面加载时初始化
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", () => {
			console.log("[Friends Global] DOMContentLoaded");
			tryInit();
		});
	} else {
		tryInit();
	}

	// 启动 MutationObserver
	setupMutationObserver();

	// 监听所有可能的页面切换事件
	var events = [
		"swup:contentReplaced",
		"swup:pageView",
		"astro:page-load",
		"astro:after-swap",
	];

	for (var i = 0; i < events.length; i++) {
		((eventName) => {
			document.addEventListener(eventName, () => {
				console.log("[Friends Global] Event:", eventName);
				window.friendsPageState.initialized = false;
				setTimeout(() => {
					tryInit();
				}, 100);
			});
		})(events[i]);
	}

	console.log("[Friends Global] All listeners registered");
})();
