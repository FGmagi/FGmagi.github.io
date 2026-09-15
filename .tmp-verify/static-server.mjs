// 临时验证用静态服务器（验证完成后删除）
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || "dist");
const extra = path.resolve(process.argv[3] || ".tmp-verify");
const port = Number(process.argv[4] || 4478);

const TYPES = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".avif": "image/avif",
	".gif": "image/gif",
	".woff2": "font/woff2",
	".woff": "font/woff",
	".ttf": "font/ttf",
	".ico": "image/x-icon",
	".xml": "application/xml",
	".txt": "text/plain; charset=utf-8",
};

function sendFile(res, file, injectProbe) {
	const ext = path.extname(file).toLowerCase();
	const type = TYPES[ext] || "application/octet-stream";
	if (injectProbe && ext === ".html") {
		let html = fs.readFileSync(file, "utf8");
		const probe = `<script>
window.__early = { t0: Math.round(performance.now()), errors: [], marks: [], swupReadyAt: null, domReadyAt: null };
window.addEventListener('error', function (e) {
  window.__early.errors.push({ t: Math.round(performance.now()), msg: String(e.message), src: String(e.filename), line: e.lineno, col: e.colno });
});
window.addEventListener('unhandledrejection', function (e) {
  var r = e.reason; window.__early.errors.push({ t: Math.round(performance.now()), msg: 'rejection: ' + String((r && r.stack) || r) });
});
['swup:enable','astro:page-load','swup:page:view','swup:content:replace','swup:content:replace'].forEach(function (n) {
  document.addEventListener(n, function () { window.__early.marks.push({ t: Math.round(performance.now()), e: n }); });
});
(function poll() {
  if (!window.__early.swupReadyAt && window.swup && window.swup.hooks) window.__early.swupReadyAt = Math.round(performance.now());
  if (!window.__early.domReadyAt && document.readyState !== 'loading') window.__early.domReadyAt = Math.round(performance.now());
  if (!window.__early.swupReadyAt) setTimeout(poll, 20);
})();
</script>`;
		html = html.replace("<head>", "<head>" + probe);
		res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
		res.end(html);
		return;
	}
	res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
	fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
	const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
	const query = new URL(req.url || "/", "http://x").searchParams;
	const injectProbe = query.get("__probe") === "1";

	// 延迟响应：用于把顶层文档的 load 事件推迟到实验做完之后（--dump-dom 在 load 后落盘）
	if (urlPath === "/__delay") {
		const ms = Math.max(0, Number(query.get("ms") || 0));
		setTimeout(() => {
			res.writeHead(200, { "Content-Type": "image/gif", "Cache-Control": "no-store" });
			res.end(Buffer.from("R0lGODlhAQABAAAAACw=", "base64"));
		}, ms);
		return;
	}

	let base = root;
	let rel = urlPath;
	if (urlPath.startsWith("/__verify/")) {
		base = extra;
		rel = urlPath.slice("/__verify".length);
	}

	let file = path.join(base, rel);
	if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
		file = path.join(file, "index.html");
	}
	if (!fs.existsSync(file)) {
		if (fs.existsSync(file + "/index.html")) file = file + "/index.html";
		else if (fs.existsSync(file + ".html")) file = file + ".html";
		else {
			res.writeHead(404, { "Content-Type": "text/plain" });
			res.end("404 " + urlPath);
			return;
		}
	}
	sendFile(res, file, injectProbe);
});

server.listen(port, "127.0.0.1", () => {
	console.log(`static server on http://127.0.0.1:${port} root=${root} extra=${extra}`);
});
