(function () {
	var out = [];
	var errors = [];
	window.addEventListener("error", function (e) {
		errors.push(String(e.message));
	});
	function sleep(ms) {
		return new Promise(function (r) {
			setTimeout(r, ms);
		});
	}
	function rect(el) {
		var b = el.getBoundingClientRect();
		return [
			Math.round(b.left),
			Math.round(b.top + window.scrollY),
			Math.round(b.width),
			Math.round(b.height),
			Math.round(b.right),
			Math.round(b.bottom + window.scrollY),
		];
	}
	function styleOf(sel, props) {
		var el = document.querySelector(sel);
		if (!el) return null;
		var st = getComputedStyle(el);
		var o = { _rect: rect(el), _display: st.display, _opacity: st.opacity };
		props.forEach(function (p) {
			o[p] = st[p];
		});
		return o;
	}
	function overflowCheck() {
		var list = [];
		var nodes = document.querySelectorAll("body *");
		for (var i = 0; i < nodes.length; i++) {
			var el = nodes[i];
			var st = getComputedStyle(el);
			if (st.display === "none" || st.visibility === "hidden" || parseFloat(st.opacity) < 0.05) continue;
			var b = el.getBoundingClientRect();
			if (b.width === 0) continue;
			if (b.right > window.innerWidth + 1 || b.left < -1)
				list.push(
					(el.id ? "#" + el.id : el.tagName.toLowerCase() + "." + String(el.className).split(/\s+/).slice(0, 2).join(".")) +
						" " +
						Math.round(b.left) +
						".." +
						Math.round(b.right),
				);
			if (list.length > 8) break;
		}
		return list;
	}
	function clipped() {
		var list = [];
		var nodes = document.querySelectorAll(
			".post-card *:not(:has(*)), .card-base span, .card-base div:not(:has(*)), .card-base a:not(:has(*))",
		);
		for (var i = 0; i < nodes.length; i++) {
			var el = nodes[i];
			var st = getComputedStyle(el);
			if (st.display === "none" || parseFloat(st.opacity) < 0.05) continue;
			if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 2 && (st.overflow !== "visible" || st.textOverflow === "ellipsis")) {
				list.push((el.textContent || "").trim().slice(0, 26) + " [" + el.clientWidth + "<" + el.scrollWidth + "]");
			}
			if (list.length > 8) break;
		}
		return list;
	}
	function keyRects() {
		var sels = {
			navbar: "#navbar",
			mainGrid: "#main-grid",
			leftSidebar: "#sidebar",
			rightSidebar: ".right-sidebar-container",
			postList: "#post-list-container",
			searchBar: ".home-search-bar",
			pagination: "div.mx-auto.mt-auto",
			profile: ".home-sidebar .card-base",
			siteStats: "#site-stats",
			calendar: "#calendar-widget",
			tagFilter: "#tag-filter",
		};
		var o = {};
		Object.keys(sels).forEach(function (k) {
			var el = document.querySelector(sels[k]);
			if (el) o[k] = rect(el);
		});
		return o;
	}
	function report(mode) {
		out.push({
			mode: mode,
			rects: keyRects(),
			bg: {
				postList: styleOf("#post-list-container", ["backgroundColor", "backdropFilter"]),
				firstCard: styleOf("#post-list-container .card-base", ["backgroundColor", "backdropFilter"]),
				leftCard: styleOf(".home-sidebar .card-base", ["backgroundColor"]),
				rightCard: styleOf(".right-sidebar-container .card-base", ["backgroundColor"]),
				searchInput: styleOf(".post-search-input", ["backgroundColor", "color"]),
				postTitle: styleOf("#post-list-container .post-card-content a", ["color", "fontSize", "fontWeight"]),
				postDesc: styleOf("#post-list-container .post-card-content div.text-75", ["color", "fontSize"]),
				tagChip: styleOf(".tag-filter-chip", ["backgroundColor", "color"]),
				statsValue: styleOf("#site-stats span.font-bold", ["color"]),
				calendarDay: styleOf(".calendar-day", ["color"]),
				paginationPage: styleOf("div.mx-auto.mt-auto .bg-\\[var\\(--primary\\)\\]", ["backgroundColor", "color"]),
			},
			overflow: overflowCheck(),
			clipped: clipped(),
			doc: {
				scrollH: document.documentElement.scrollHeight,
				scrollW: document.documentElement.scrollWidth,
				clientW: document.documentElement.clientWidth,
				rootFont: getComputedStyle(document.documentElement).fontSize,
			},
		});
	}
	async function run() {
		report("as-loaded");

		document.body.classList.add("simple-mode");
		await sleep(900);
		report("simple-mode");
		document.body.classList.remove("simple-mode");

		document.documentElement.classList.add("dark");
		await sleep(900);
		report("dark");

		document.body.classList.add("simple-mode");
		await sleep(900);
		report("dark+simple");
		document.body.classList.remove("simple-mode");

		// 无壁纸模式
		var fs = document.querySelector("[data-fullscreen-wallpaper]");
		if (fs) fs.style.display = "none";
		document.body.classList.remove("wallpaper-transparent");
		document.body.classList.add("no-banner-mode");
		await sleep(900);
		report("dark+none-wallpaper");
		document.documentElement.classList.remove("dark");

		out.push({ errors: errors });
		var pre = document.createElement("pre");
		pre.id = "__probe_modes";
		pre.textContent = JSON.stringify(out, null, 1);
		document.documentElement.appendChild(pre);
	}
	if (document.readyState === "complete") setTimeout(run, 3000);
	else
		window.addEventListener("load", function () {
			setTimeout(run, 3000);
		});
})();
