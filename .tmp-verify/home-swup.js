(function () {
	var errors = [];
	window.addEventListener("error", function (e) {
		errors.push("error: " + e.message);
	});
	window.addEventListener("unhandledrejection", function (e) {
		errors.push("rejection: " + String((e.reason && e.reason.message) || e.reason));
	});
	function sleep(ms) {
		return new Promise(function (r) {
			setTimeout(r, ms);
		});
	}
	function counts() {
		var q = function (s) {
			return document.querySelectorAll(s).length;
		};
		return {
			path: location.pathname,
			postListContainers: q("#post-list-container"),
			searchBars: q(".post-search-bar-home, .home-search-bar"),
			siteStats: q("#site-stats"),
			calendars: q("#calendar-widget"),
			tagFilter: q("#tag-filter"),
			profiles: q(".home-sidebar .card-base"),
			sidebars: q("#sidebar"),
			rightSidebars: q(".right-sidebar-container"),
			walls: q("[data-fullscreen-wallpaper]"),
			navbars: q("#navbar"),
			blankCards: q(".blank-post-card"),
			cards: q("#post-list-container > .card-base"),
			footers: q("footer, .footer"),
			bodyClass: document.body.className,
			scripts: document.scripts.length,
			pagePrerender: document.body.classList.contains("page-prerender"),
			mainGridOpacity: getComputedStyle(document.querySelector("#main-grid") || document.body).opacity,
		};
	}
	function clickLink(sel, pred) {
		var links = [].slice.call(document.querySelectorAll(sel));
		var target = links.filter(pred)[0] || links[0];
		if (!target) return null;
		var href = target.getAttribute("href");
		target.click();
		return href;
	}
	async function run() {
		var out = [{ step: "initial", c: counts() }];
		out.push({
			step: "swup-present",
			swup: typeof window.swup,
			hooks: !!(window.swup && window.swup.hooks),
		});

		// 到 /archive/
		var href1 = clickLink("a[href]", function (a) {
			return /\/archive\/?$/.test(a.getAttribute("href") || "");
		});
		await sleep(2200);
		out.push({ step: "to-archive", clicked: href1, c: counts() });

		// 回首页
		var href2 = clickLink("a[href]", function (a) {
			return (a.getAttribute("href") || "") === "/" && a.closest("#navbar") !== null;
		});
		await sleep(2500);
		out.push({ step: "back-home", clicked: href2, c: counts() });

		// 再切一次：首页 -> 相册/友链 -> 首页（多轮观察累积）
		for (var i = 0; i < 2; i++) {
			clickLink("a[href]", function (a) {
				return /\/friends\/?$/.test(a.getAttribute("href") || "");
			});
			await sleep(1500);
			clickLink("a[href]", function (a) {
				return (a.getAttribute("href") || "") === "/";
			});
			await sleep(2000);
			out.push({ step: "round-" + i, c: counts() });
		}
		out.push({ step: "errors", errors: errors.slice(0, 20) });

		// 事件监听器累积检测：统计 window 上 swup 钩子数（通过再次触发一次跳转对比 DOM 数量）
		var pre = document.createElement("pre");
		pre.id = "__probe_swup";
		pre.textContent = JSON.stringify(out, null, 1);
		document.documentElement.appendChild(pre);
	}
	if (document.readyState === "complete") setTimeout(run, 2500);
	else
		window.addEventListener("load", function () {
			setTimeout(run, 2500);
		});
})();
