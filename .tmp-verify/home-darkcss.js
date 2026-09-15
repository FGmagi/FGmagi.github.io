// 排查：暗色模式下首页文章标题/摘要为何仍是黑色文字
(function () {
	function run() {
		document.documentElement.classList.add("dark");
		var target = document.querySelector("#post-list-container .post-card-content a");
		var desc = document.querySelector("#post-list-container .post-card-content div.text-75");
		var statsSpan = document.querySelector("#site-stats span.font-bold");
		var info = {
			htmlClass: document.documentElement.className,
			title: target
				? {
						class: target.className,
						color: getComputedStyle(target).color,
						matchesDark: target.matches(".dark *"),
						matchesIsDark: target.matches(":is(.dark *)"),
					}
				: null,
			desc: desc ? { class: desc.className, color: getComputedStyle(desc).color } : null,
			stats: statsSpan ? { class: statsSpan.className, color: getComputedStyle(statsSpan).color } : null,
			rules: [],
		};
		// 决定性测试：新建一个 .text-90 元素放进 body，看暗色规则是否生效
		var probeEl = document.createElement("div");
		probeEl.className = "text-90";
		probeEl.textContent = "probe";
		document.body.appendChild(probeEl);
		info.freshText90 = getComputedStyle(probeEl).color;
		var probeEl2 = document.createElement("div");
		probeEl2.className = "text-75";
		document.body.appendChild(probeEl2);
		info.freshText75 = getComputedStyle(probeEl2).color;
		var probeEl3 = document.createElement("div");
		probeEl3.className = "dark:text-white";
		document.body.appendChild(probeEl3);
		info.freshDarkVariant = getComputedStyle(probeEl3).color;
		var a2 = document.createElement("a");
		a2.className = "transition text-90";
		document.body.appendChild(a2);
		info.freshAnchorText90 = getComputedStyle(a2).color;
		// 父链上的 color 与选择器
		var chain = [];
		var el = target;
		while (el && el !== document.documentElement.parentElement) {
			var st = getComputedStyle(el);
			chain.push(
				(el.tagName || "") +
					"." +
					String(el.className || "").split(/\s+/).slice(0, 4).join(".") +
					" color=" +
					st.color,
			);
			el = el.parentElement;
		}
		info.chain = chain;
		// 找出所有对标题元素生效、且声明了 color 的规则（按样式表顺序）
		for (var i = 0; i < document.styleSheets.length; i++) {
			var ss = document.styleSheets[i];
			var rules;
			try {
				rules = ss.cssRules;
			} catch (e) {
				continue;
			}
			if (!rules) continue;
			var walk = function (list, mediaText) {
				for (var j = 0; j < list.length; j++) {
					var r = list[j];
					if (r.cssRules && (r.media || r.selectorText === undefined)) {
						walk(r.cssRules, mediaText || (r.media && r.media.mediaText) || r.conditionText || "");
						continue;
					}
					if (!r.selectorText || !r.style || !r.style.color) continue;
					for (var s = 0; s < r.selectorText.split(",").length; s++) {
						var sel = r.selectorText.split(",")[s].trim();
						if (!sel) continue;
						var matches = false;
						try {
							matches = target.matches(sel);
						} catch (e) {}
						if (matches)
							info.rules.push({
								href: (ss.href || "inline").split("/").pop(),
								media: mediaText || "",
								selector: sel,
								color: r.style.color,
							});
					}
				}
			};
			walk(rules, "");
		}
		var pre = document.createElement("pre");
		pre.id = "__probe_darkcss";
		pre.textContent = JSON.stringify(info, null, 1);
		document.documentElement.appendChild(pre);
	}
	if (document.readyState === "complete") setTimeout(run, 3000);
	else
		window.addEventListener("load", function () {
			setTimeout(run, 3000);
		});
})();
