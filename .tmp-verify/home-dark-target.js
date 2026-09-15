// 关掉 CSS 过渡后再切暗色，读到的就是「终态」颜色（排除过渡中间值造成的误判）
(function () {
	function run() {
		var style = document.createElement("style");
		style.textContent = "*,*::before,*::after{transition:none !important;animation:none !important}";
		document.head.appendChild(style);
		var out = { light: {}, dark: {} };
		function snap(tag) {
			var o = {};
			var map = {
				title: "#post-list-container .post-card-content a",
				desc: "#post-list-container .post-card-content .text-75",
				card: "#post-list-container .card-base",
				leftCard: ".home-sidebar .card-base",
				searchInput: ".post-search-input",
				chip: ".tag-filter-chip",
				stats: "#site-stats span.font-bold",
				calDay: ".calendar-day",
				pager: "div.mx-auto.mt-auto .bg-\\[var\\(--primary\\)\\]",
				navLink: "#navbar a.btn-plain",
				bodyText: "body",
			};
			Object.keys(map).forEach(function (k) {
				var el = document.querySelector(map[k]);
				if (!el) {
					o[k] = null;
					return;
				}
				var st = getComputedStyle(el);
				o[k] = { color: st.color, bg: st.backgroundColor };
			});
			out[tag] = o;
		}
		snap("light");
		document.documentElement.classList.add("dark");
		// 强制一次样式重算
		void document.body.offsetHeight;
		snap("dark");
		out.htmlClass = document.documentElement.className;
		out.bodyClass = document.body.className;
		var pre = document.createElement("pre");
		pre.id = "__probe_darktarget";
		pre.textContent = JSON.stringify(out, null, 1);
		document.documentElement.appendChild(pre);
	}
	if (document.readyState === "complete") setTimeout(run, 3000);
	else
		window.addEventListener("load", function () {
			setTimeout(run, 3000);
		});
})();
