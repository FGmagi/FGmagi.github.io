// 临时验证用：把 dev server 的 HTML 透传并注入探针脚本，其余请求原样代理。
// 用途：无头 Chrome 无法直接注入脚本时，用 --dump-dom 抓取测量结果。
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const UPSTREAM = process.env.PROBE_UPSTREAM || "http://127.0.0.1:4330";
const PORT = Number(process.env.PROBE_PORT || 4399);
const probeFile = path.resolve(process.argv[2] || ".tmp-verify/home-probe.js");
const probe = fs.readFileSync(probeFile, "utf8");
const headFile = process.env.PROBE_HEAD
	? path.resolve(process.env.PROBE_HEAD)
	: null;
const headScript = headFile ? fs.readFileSync(headFile, "utf8") : "";

const server = http.createServer(async (req, res) => {
	try {
		const upstream = await fetch(UPSTREAM + req.url, {
			method: req.method,
			headers: { "user-agent": "probe", accept: req.headers.accept || "*/*" },
		});
		const type = upstream.headers.get("content-type") || "";
		if (type.includes("text/html")) {
			let html = await upstream.text();
			const tag = `<script>${probe}</script>`;
			if (headScript) {
				html = html.includes("<head>")
					? html.replace("<head>", "<head><script>" + headScript + "</script>")
					: `<script>${headScript}</script>` + html;
			}
			html = html.includes("</body>")
				? html.replace("</body>", tag + "</body>")
				: html + tag;
			res.writeHead(upstream.status, {
				"content-type": "text/html; charset=utf-8",
				"cache-control": "no-store",
			});
			res.end(html);
			return;
		}
		const buf = Buffer.from(await upstream.arrayBuffer());
		res.writeHead(upstream.status, {
			"content-type": type || "application/octet-stream",
			"cache-control": "no-store",
		});
		res.end(buf);
	} catch (err) {
		res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
		res.end("proxy error: " + String(err));
	}
});

server.listen(PORT, "127.0.0.1", () => {
	console.log(`probe server on http://127.0.0.1:${PORT} -> ${UPSTREAM}`);
});
