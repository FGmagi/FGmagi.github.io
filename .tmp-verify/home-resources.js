(function () {
	function run() {
		var list = performance.getEntriesByType("resource").map(function (e) {
			return {
				url: e.name.replace(location.origin, ""),
				initiatorType: e.initiatorType,
				transferKB: Math.round((e.transferSize || 0) / 102.4) / 10,
				decodedKB: Math.round((e.decodedBodySize || 0) / 102.4) / 10,
				start: Math.round(e.startTime),
				dur: Math.round(e.duration),
			};
		});
		var imgs = [].map.call(document.querySelectorAll("img"), function (im) {
			var b = im.getBoundingClientRect();
			return {
				src: (im.currentSrc || im.src || "").replace(location.origin, "").slice(-70),
				loading: im.getAttribute("loading"),
				decoding: im.getAttribute("decoding"),
				fetchpriority: im.getAttribute("fetchpriority"),
				visible: b.width > 0 && b.height > 0,
				size: Math.round(b.width) + "x" + Math.round(b.height),
				nat: im.naturalWidth + "x" + im.naturalHeight,
				complete: im.complete,
			};
		});
		var out = { count: list.length, resources: list, images: imgs };
		var pre = document.createElement("pre");
		pre.id = "__probe_resources";
		pre.textContent = JSON.stringify(out, null, 1);
		document.documentElement.appendChild(pre);
	}
	if (document.readyState === "complete") setTimeout(run, 3000);
	else window.addEventListener("load", function () {
		setTimeout(run, 3000);
	});
})();
