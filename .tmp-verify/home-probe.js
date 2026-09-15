(function () {
	var errors = [];
	window.addEventListener("error", function (e) {
		errors.push({ msg: String(e.message), src: String(e.filename), line: e.lineno });
	});
	window.addEventListener("unhandledrejection", function (e) {
		var r = e.reason;
		errors.push({ msg: "rejection: " + String((r && r.message) || r) });
	});
	var origWarn = console.warn;
	console.warn = function () {
		errors.push({ msg: "warn: " + Array.prototype.join.call(arguments, " ") });
		return origWarn.apply(console, arguments);
	};

	function r2(n) {
		return Math.round(n * 100) / 100;
	}

	function rect(el) {
		var b = el.getBoundingClientRect();
		return {
			x: r2(b.left),
			y: r2(b.top + window.scrollY),
			w: r2(b.width),
			h: r2(b.height),
			r: r2(b.right),
			b: r2(b.bottom + window.scrollY),
		};
	}

	function short(el) {
		if (!el || el.nodeType !== 1) return String(el);
		var s = el.tagName.toLowerCase();
		if (el.id) s += "#" + el.id;
		var cls = (el.getAttribute("class") || "")
			.split(/\s+/)
			.filter(function (c) {
				return c && !/^(onload-animation|transition-swup-fade)$/.test(c);
			})
			.slice(0, 3)
			.join(".");
		if (cls) s += "." + cls;
		return s;
	}

	function find(sel, root) {
		var el = (root || document).querySelector(sel);
		return el ? { sel: sel, el: el, rect: rect(el) } : null;
	}

	function overlaps(a, b) {
		return !(a.r <= b.x || b.r <= a.x || a.b <= b.y || b.b <= a.y);
	}

	function overflowX() {
		var out = [];
		var nodes = document.querySelectorAll("body *");
		for (var i = 0; i < nodes.length; i++) {
			var el = nodes[i];
			var st = getComputedStyle(el);
			if (st.display === "none" || st.visibility === "hidden") continue;
			var b = el.getBoundingClientRect();
			if (b.width === 0) continue;
			if (b.right > window.innerWidth + 1 || b.left < -1) {
				out.push({
					el: short(el),
					x: r2(b.left),
					r: r2(b.right),
					w: r2(b.width),
					overflowY: st.overflowY,
					overflowX: st.overflowX,
				});
			}
			if (out.length > 25) break;
		}
		return out;
	}

	function clippedText() {
		var out = [];
		var nodes = document.querySelectorAll(
			"p, span, a, h1, h2, h3, h4, li, td, .post-title, .badge",
		);
		for (var i = 0; i < nodes.length; i++) {
			var el = nodes[i];
			if (el.children.length > 0) continue;
			var st = getComputedStyle(el);
			if (st.display === "none" || st.overflow === "hidden") {
				if (st.display === "none") continue;
			}
			var clipped =
				el.scrollWidth > el.clientWidth + 1 &&
				el.clientWidth > 0 &&
				(st.overflow === "hidden" || st.textOverflow === "ellipsis");
			if (clipped) {
				out.push({
					el: short(el),
					text: (el.textContent || "").trim().slice(0, 40),
					client: el.clientWidth,
					scroll: el.scrollWidth,
					overflow: st.overflow,
				});
			}
			if (out.length > 15) break;
		}
		return out;
	}

	function cardRects() {
		var cards = document.querySelectorAll(".card-base");
		var out = [];
		for (var i = 0; i < cards.length; i++) {
			var r = rect(cards[i]);
			if (r.w === 0 || r.h === 0) continue;
			out.push({ el: short(cards[i]), ...r });
		}
		return out;
	}

	function resourceStats() {
		var list = performance.getEntriesByType("resource");
		var byType = {};
		var failed = [];
		for (var i = 0; i < list.length; i++) {
			var e = list[i];
			var ext = (e.name.split("?")[0].split(".").pop() || "").toLowerCase();
			byType[ext] = (byType[ext] || 0) + 1;
			if (e.responseStatus && e.responseStatus >= 400) {
				failed.push({ url: e.name.slice(0, 120), status: e.responseStatus });
			}
		}
		return {
			total: list.length,
			byType: byType,
			failed: failed,
			transferKB: r2(
				list.reduce(function (a, e) {
					return a + (e.transferSize || 0);
				}, 0) / 1024,
			),
		};
	}

	function imageStats() {
		var imgs = document.querySelectorAll("img");
		var broken = [];
		var loadingAttr = {};
		for (var i = 0; i < imgs.length; i++) {
			var im = imgs[i];
			var la = im.getAttribute("loading") || "(none)";
			loadingAttr[la] = (loadingAttr[la] || 0) + 1;
			if (im.complete && im.naturalWidth === 0) {
				broken.push({ src: (im.currentSrc || im.src || "").slice(-60), el: short(im) });
			}
		}
		return { count: imgs.length, loadingAttr: loadingAttr, broken: broken };
	}

	function measure() {
		var report = {
			url: location.pathname + location.search,
			viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
			bodyClass: document.body.className,
			doc: {
				scrollW: document.documentElement.scrollWidth,
				clientW: document.documentElement.clientWidth,
				scrollH: document.documentElement.scrollHeight,
				rootFontSize: getComputedStyle(document.documentElement).fontSize,
			},
			fonts: { status: document.fonts.status, size: document.fonts.size },
			errors: errors.slice(0, 20),
			resources: resourceStats(),
			images: imageStats(),
			overflowing: overflowX(),
			clippedText: clippedText(),
			cards: cardRects(),
			key: {},
		};

		var keys = {
			topRow: "#top-row",
			navbar: "#navbar-wrapper",
			navbarCard: "#navbar",
			mainGrid: "#main-grid",
			leftSidebar: ".home-sidebar",
			mainContent: ".absolute.w-full.z-30",
			postList: "#post-list-container",
			searchBar: ".home-search-bar",
			pagination: ".pagination, .pagination-bar, nav[aria-label]",
			firstCard: ".post-card",
		};
		Object.keys(keys).forEach(function (k) {
			var found = find(keys[k]);
			if (found) report.key[k] = found.rect;
		});

		// 文章卡片逐个体量（首页列表）
		var posts = document.querySelectorAll(".post-card");
		report.posts = [];
		for (var i = 0; i < Math.min(posts.length, 12); i++) {
			report.posts.push({ el: short(posts[i]), ...rect(posts[i]) });
		}

		// 侧栏小卡片
		var sideCards = document.querySelectorAll(".home-sidebar > *");
		report.sideWidgets = [];
		for (var j = 0; j < sideCards.length; j++) {
			var sc = sideCards[j];
			if (getComputedStyle(sc).display === "none") continue;
			report.sideWidgets.push({ el: short(sc), ...rect(sc) });
		}

		// 关键两两重叠检查
		var pairs = [];
		function pushPair(name, a, b) {
			if (!a || !b) return;
			var ra = rect(a);
			var rb = rect(b);
			if (ra.w === 0 || rb.w === 0) return;
			pairs.push({
				name: name,
				overlap: overlaps(ra, rb),
				gapX: r2(Math.max(rb.x - ra.r, ra.x - rb.r)),
				a: ra,
				b: rb,
			});
		}
		var nav = document.querySelector("#navbar");
		var main = document.querySelector("#main-grid");
		var list = document.querySelector("#post-list-container");
		var left = document.querySelector(".home-sidebar");
		var right = document.querySelector(".right-sidebar-container");
		pushPair("navbar-vs-main", nav, main);
		pushPair("navbar-vs-postList", nav, list);
		pushPair("left-vs-postList", left, list);
		pushPair("postList-vs-right", list, right);
		pushPair("searchBar-vs-postList", document.querySelector(".home-search-bar"), list);
		report.pairs = pairs;

		// 主要容器的左右边距（相对视口）
		var edge = {};
		["#navbar", "#post-list-container", ".home-sidebar", ".home-search-bar"].forEach(function (sel) {
			var el = document.querySelector(sel);
			if (!el) return;
			var r = rect(el);
			if (r.w === 0) return;
			edge[sel] = { left: r.x, right: r2(window.innerWidth - r.r), width: r.w };
		});
		report.edges = edge;

		var pre = document.createElement("pre");
		pre.id = "__probe_report";
		pre.textContent = JSON.stringify(report, null, 1);
		document.documentElement.appendChild(pre);
	}

	function boot() {
		setTimeout(measure, 3500);
	}
	if (document.readyState === "complete") boot();
	else window.addEventListener("load", boot);
})();
