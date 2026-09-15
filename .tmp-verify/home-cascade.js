// 枚举真正命中标题元素的 color 声明（含嵌套规则 / @layer / !important / 内联样式）
(function () {
	function run() {
		document.documentElement.classList.add("dark");
		var target = document.querySelector("#post-list-container .post-card-content a");
		var out = {
			inlineStyle: target.getAttribute("style"),
			computed: getComputedStyle(target).color,
			decls: [],
		};
		var order = 0;
		function resolveParent(sel, parentSel) {
			if (!sel || !parentSel) return sel;
			if (sel.indexOf("&") >= 0) return sel.replace(/&/g, parentSel);
			return parentSel + " " + sel;
		}
		function walk(rules, ctx, parentSel) {
			for (var i = 0; i < rules.length; i++) {
				var r = rules[i];
				var type = r.constructor && r.constructor.name;
				if (r.cssRules && r.selectorText === undefined) {
					// @media / @layer / @supports / @container
					var label = type + (r.name ? ":" + r.name : "") + (r.media ? ":" + r.media.mediaText : r.conditionText ? ":" + r.conditionText : "");
					walk(r.cssRules, ctx.concat(label), parentSel);
					continue;
				}
				var effective = resolveParent(r.selectorText, parentSel);
				if (r.style && r.style.length) {
					var color = r.style.getPropertyValue("color");
					if (color) {
						var m = false;
						try {
							m = target.matches(effective);
						} catch (e) {
							m = "SYNTAX:" + String(e).slice(0, 40);
						}
						if (m)
							out.decls.push({
								order: order++,
								ctx: ctx.join(" > "),
								selector: effective,
								color: color,
								important: r.style.getPropertyPriority("color"),
							});
					}
				}
				if (r.cssRules && r.cssRules.length) walk(r.cssRules, ctx, effective);
			}
		}
		for (var s = 0; s < document.styleSheets.length; s++) {
			var ss = document.styleSheets[s];
			var rules = null;
			try {
				rules = ss.cssRules;
			} catch (e) {
				out.decls.push({ sheet: ss.href, error: "cannot read" });
				continue;
			}
			if (rules) walk(rules, [(ss.href || "inline").split("/").pop()], null);
		}
		var pre = document.createElement("pre");
		pre.id = "__probe_cascade";
		pre.textContent = JSON.stringify(out, null, 1);
		document.documentElement.appendChild(pre);
	}
	if (document.readyState === "complete") setTimeout(run, 3000);
	else
		window.addEventListener("load", function () {
			setTimeout(run, 3000);
		});
})();
