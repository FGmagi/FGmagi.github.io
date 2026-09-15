(function () {
	function r(n) {
		return Math.round(n);
	}
	var lines = [];
	function walk(el, depth) {
		if (depth > 14) return;
		var st = getComputedStyle(el);
		if (st.display === "none") {
			lines.push(
				"  ".repeat(depth) +
					tag(el) +
					"  [display:none]",
			);
			return;
		}
		var b = el.getBoundingClientRect();
		var txt = "";
		var leaf = true;
		for (var i = 0; i < el.children.length; i++) {
			if (el.children[i].tagName.toLowerCase() !== "svg") leaf = false;
			break;
		}
		leaf = el.children.length === 0;
		if (leaf) txt = " » " + (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 70);
		lines.push(
			"  ".repeat(depth) +
				tag(el) +
				"  @" +
				r(b.left) +
				"," +
				r(b.top + window.scrollY) +
				" " +
				r(b.width) +
				"x" +
				r(b.height) +
				(st.visibility === "hidden" ? " [hidden]" : "") +
				(st.opacity !== "1" ? " [opacity:" + st.opacity + "]" : "") +
				(st.overflow !== "visible" ? " [overflow:" + st.overflow + "]" : "") +
				txt,
		);
		for (var i = 0; i < el.children.length; i++) {
			var c = el.children[i];
			if (["svg", "defs", "symbol"].indexOf(c.tagName.toLowerCase()) >= 0) continue;
			walk(c, depth + 1);
		}
	}
	function tag(el) {
		var s = el.tagName.toLowerCase();
		if (el.id) s += "#" + el.id;
		var cls = (el.getAttribute("class") || "").trim();
		if (cls) s += "." + cls.split(/\s+/).slice(0, 5).join(".");
		return s;
	}
	function run() {
		var root = document.querySelector("#main-grid") || document.body;
		lines.push("### NAVBAR ###");
		var nav = document.querySelector("#top-row");
		if (nav) walk(nav, 0);
		lines.push("");
		lines.push("### PAGE CONTENT (from #main-grid) ###");
		walk(root.parentElement || root, 0);
		lines.push("");
		lines.push("### FULLSCREEN WALLPAPER ###");
		var fs = document.querySelector("[data-fullscreen-wallpaper]");
		if (fs) walk(fs, 0);
		var pre = document.createElement("pre");
		pre.id = "__probe_outline";
		pre.textContent = lines.join("\n");
		document.documentElement.appendChild(pre);
	}
	function boot() {
		setTimeout(run, 3500);
	}
	if (document.readyState === "complete") boot();
	else window.addEventListener("load", boot);
})();
