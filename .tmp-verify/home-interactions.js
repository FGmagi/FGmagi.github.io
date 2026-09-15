(function () {
	var R = [];
	function log(o) {
		R.push(o);
	}
	function sleep(ms) {
		return new Promise(function (r) {
			setTimeout(r, ms);
		});
	}
	function rect(el) {
		var b = el.getBoundingClientRect();
		return (
			Math.round(b.left) +
			"," +
			Math.round(b.top) +
			" " +
			Math.round(b.width) +
			"x" +
			Math.round(b.height)
		);
	}
	function short(el) {
		if (!el) return "(null)";
		return (
			el.tagName.toLowerCase() +
			(el.id ? "#" + el.id : "") +
			(el.getAttribute("class") ? "." + el.getAttribute("class").split(/\s+/).slice(0, 3).join(".") : "")
		);
	}

	async function run() {
		// --- 1. 分页按钮（单页时） ---
		var pag = document.querySelectorAll(".mx-auto.mt-auto a.btn-card, .mx-auto.mt-auto .btn-card");
		var prev = document.querySelector('.mx-auto.mt-auto a[aria-label], .mx-auto.mt-auto a.btn-card');
		var anchors = document.querySelectorAll("div.mx-auto.mt-auto a");
		log({
			step: "pagination",
			count: anchors.length,
			items: [].map.call(anchors, function (a) {
				var st = getComputedStyle(a);
				return {
					el: short(a),
					href: a.getAttribute("href"),
					resolved: a.href,
					cls: a.className,
					pointerEvents: st.pointerEvents,
					opacity: st.opacity,
					cursor: st.cursor,
					ariaLabel: a.getAttribute("aria-label"),
					ariaDisabled: a.getAttribute("aria-disabled"),
					tabIndex: a.tabIndex,
					rect: rect(a),
				};
			}),
		});

		// --- 2. 标签筛选：点击第一个 chip ---
		var chips = document.querySelectorAll(".tag-filter-chip");
		log({ step: "tagFilter.count", chips: chips.length });
		if (chips.length) {
			var cards = document.querySelectorAll("#post-list-container .card-base");
			var visibleBefore = [].filter.call(cards, function (c) {
				return getComputedStyle(c).display !== "none";
			}).length;
			chips[0].click();
			await sleep(400);
			var after = [].filter.call(cards, function (c) {
				var st = getComputedStyle(c);
				return st.display !== "none" && st.opacity !== "0";
			});
			log({
				step: "tagFilter.click",
				chip: (chips[0].textContent || "").trim(),
				visibleBefore: visibleBefore,
				visibleAfter: after.length,
				afterTitles: after.map(function (c) {
					var t = c.querySelector(".post-card-content a");
					return t ? (t.textContent || "").trim().slice(0, 20) : "?";
				}),
				activeChips: document.querySelectorAll(".tag-filter-chip.active, .tag-filter-chip.is-active").length,
				errors: window.__probeErrors || [],
			});
			chips[0].click();
			await sleep(300);
		}

		// --- 3. 搜索栏：输入 + Enter ---
		var input = document.querySelector(".post-search-input");
		if (input) {
			input.focus();
			input.value = "笔记";
			input.dispatchEvent(new Event("input", { bubbles: true }));
			await sleep(120);
			var before = location.href;
			input.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
			);
			await sleep(900);
			log({
				step: "search.enter",
				before: before,
				after: location.href,
				changed: before !== location.href,
			});
			// 回到首页
			if (location.pathname !== "/") {
				history.back();
				await sleep(1200);
			}
		}

		// --- 4. 滚动：回顶按钮 / 导航栏 / 描边线 ---
		var docH = document.documentElement.scrollHeight;
		log({ step: "scroll.docHeight", docH: docH, viewport: window.innerHeight });
		if (docH > window.innerHeight + 50) {
			window.scrollTo(0, Math.round(docH * 0.6));
			await sleep(600);
			var btn = document.querySelector("#back-to-top-btn");
			var sep = document.querySelector("#navbar-card-separator");
			var nav = document.querySelector("#top-row");
			log({
				step: "scroll",
				scrollY: Math.round(window.scrollY),
				backToTop: btn
					? {
							cls: btn.className,
							opacity: getComputedStyle(btn).opacity,
							display: getComputedStyle(btn).display,
							rect: rect(btn),
						}
					: null,
				separator: sep
					? {
							cls: sep.className,
							opacity: getComputedStyle(sep).opacity,
							top: getComputedStyle(sep).top,
							rect: rect(sep),
						}
					: null,
				navPosition: nav ? getComputedStyle(nav).position : null,
				navRect: nav ? rect(nav) : null,
			});
			window.scrollTo(0, 0);
			await sleep(400);
		}

		// --- 5. 键盘可达性：分页与标签是否可 tab ---
		var focusables = document.querySelectorAll(
			"a[href], button, input, [tabindex]:not([tabindex='-1'])",
		);
		var noName = [];
		[].forEach.call(focusables, function (f) {
			var name =
				(f.getAttribute("aria-label") || f.textContent || "").trim() ||
				f.getAttribute("title") ||
				"";
			if (!name && getComputedStyle(f).display !== "none") noName.push(short(f));
		});
		log({ step: "a11y.focusables", total: focusables.length, withoutName: noName.slice(0, 20) });

		// --- 6. 图片 loading / 尺寸 ---
		var imgs = [].map.call(document.querySelectorAll("img"), function (im) {
			var b = im.getBoundingClientRect();
			return {
				src: (im.currentSrc || im.src || "").split("/").pop().slice(0, 30),
				loading: im.getAttribute("loading"),
				visible: b.width > 1,
				css: Math.round(b.width) + "x" + Math.round(b.height),
				nat: im.naturalWidth + "x" + im.naturalHeight,
			};
		});
		log({ step: "images", imgs: imgs });

		var pre = document.createElement("pre");
		pre.id = "__probe_interactions";
		pre.textContent = JSON.stringify(R, null, 1);
		document.documentElement.appendChild(pre);
	}

	window.addEventListener("error", function (e) {
		(window.__probeErrors = window.__probeErrors || []).push(String(e.message));
	});
	if (document.readyState === "complete") setTimeout(run, 3000);
	else
		window.addEventListener("load", function () {
			setTimeout(run, 3000);
		});
})();
