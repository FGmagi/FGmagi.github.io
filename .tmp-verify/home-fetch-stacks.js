(function () {
	var log = [];
	var origFetch = window.fetch;
	window.fetch = function (input, init) {
		var url = typeof input === "string" ? input : input && input.url;
		if (url && !/\/(@vite|@id|src\/|node_modules)/.test(url)) {
			var stack = (new Error().stack || "").split("\n").slice(1, 6).join(" <- ");
			log.push({ t: Math.round(performance.now()), url: String(url).slice(0, 90), stack: stack });
		}
		return origFetch.apply(this, arguments);
	};
	var OrigXHR = window.XMLHttpRequest;
	function logXhr(method, url) {
		if (url && !/\/(@vite|@id|src\/|node_modules)/.test(url)) {
			var stack = (new Error().stack || "").split("\n").slice(1, 6).join(" <- ");
			log.push({ t: Math.round(performance.now()), kind: "xhr", url: String(url).slice(0, 90), stack: stack });
		}
	}
	window.XMLHttpRequest = function () {
		var x = new OrigXHR();
		var open = x.open;
		x.open = function (m, u) {
			logXhr(m, u);
			return open.apply(x, arguments);
		};
		return x;
	};
	function run() {
		var byUrl = {};
		log.forEach(function (e) {
			var k = e.url.split("?")[0];
			byUrl[k] = byUrl[k] || { count: 0, first: e.t, stacks: [] };
			byUrl[k].count++;
			if (byUrl[k].stacks.length < 2) byUrl[k].stacks.push(e.t + " " + e.stack);
		});
		var pre = document.createElement("pre");
		pre.id = "__probe_stacks";
		pre.textContent = JSON.stringify(
			{ rounds: log.length, first: log.slice(0, 4), byUrl: byUrl },
			null,
			1,
		);
		document.documentElement.appendChild(pre);
	}
	setTimeout(run, 18000);
})();
