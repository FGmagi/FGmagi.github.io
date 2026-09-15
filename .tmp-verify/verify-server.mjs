// 26.09.14 临时验证静态服务器：注入「导航栏常驻 + 预渲染」探针，把测量结果写进 document.title。
// 用法：node .tmp-verify/verify-server.mjs <distRoot> <port>
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || ".tmp-verify/dist-nav");
const port = Number(process.argv[3] || 4488);

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

const PROBE = `<script>
(function () {
  window.__navReport = { errors: [], marks: [] };
  window.addEventListener('error', function (e) { window.__navReport.errors.push(String(e.message)); });
  function rect(sel) {
    var el = document.querySelector(sel);
    if (!el) return null;
    var r = el.getBoundingClientRect();
    var cs = getComputedStyle(el);
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), op: cs.opacity, pos: cs.position, disp: cs.display, vis: cs.visibility };
  }
  function frame() {
    var rows = [];
    var row = document.getElementById('top-row');
    var nav = document.getElementById('navbar');
    var sp = document.getElementById('top-row-space');
    rows.push('topRowH=' + (row ? Math.round(row.getBoundingClientRect().height) : 'null') + ' spacerH=' + (sp ? Math.round(sp.getBoundingClientRect().height) : 'null'));
    document.addEventListener('astro:page-load', function () { window.__navReport.marks.push('astro:page-load'); });
    document.addEventListener('swup:content:replace', function () {
      var m = {
        t: 'content:replace',
        body: document.body.className,
        pre: rect('.page-transition-region'),
        toc: rect('#toc-container'),
        railDisp: row ? getComputedStyle(document.getElementById('toc-rail-wrapper') || document.body).display : 'n/a',
        tocLayout: document.documentElement.getAttribute('data-toc-layout')
      };
      window.__navReport.marks.push(m);
      setTimeout(function () {
        window.__navReport.marks.push({
          t: 'replace+80',
          body: document.body.className,
          pre: rect('.page-transition-region'),
          toc: rect('#toc-container')
        });
      }, 80);
      setTimeout(function () {
        window.__navReport.marks.push({
          t: 'replace+400',
          body: document.body.className,
          pre: rect('.page-transition-region'),
          toc: rect('#toc-container'),
          tocLinks: document.querySelectorAll("table-of-contents#toc a[href^='#']").length
        });
        finish();
      }, 400);
    });
    window.__navReport.setup = rows.join(' | ') + ' | nav=' + JSON.stringify(rect('#navbar')) + ' | row=' + JSON.stringify(rect('#top-row'));
    window.__navReport.scrollTest = [];
    var pts = [0, 200, 800, 2000, 600];
    var i = 0;
    function step() {
      if (i >= pts.length) {
        if (!document.querySelector('#navbar')) finish();
        return;
      }
      var y = pts[i++];
      window.scrollTo(0, y);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          window.__navReport.scrollTest.push({ y: y, nav: rect('#navbar'), row: rect('#top-row'), scrollY: Math.round(window.scrollY) });
          step();
        });
      });
    }
    var navLink = document.querySelector('a[href^="/archive"]') || document.querySelector('#navbar a[href^="/"]:not([href="/"])');
    if (navLink) {
      window.__navReport.navClicked = navLink.getAttribute('href');
      navLink.click();
    } else {
      window.__navReport.navClicked = null;
      step();
      setTimeout(finish, 600);
    }
  }
  var done = false;
  function finish() {
    if (done) return;
    done = true;
    document.title = 'REPORT:' + JSON.stringify(window.__navReport);
  }
  setTimeout(function () { finish(); }, 6000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(frame, 300); });
  else setTimeout(frame, 300);
})();
</script>`;

function send(res, file) {
	const ext = path.extname(file).toLowerCase();
	let body = fs.readFileSync(file);
	if (ext === ".html") {
		let html = body.toString("utf8");
		if (html.includes("<head>")) html = html.replace("<head>", "<head>" + PROBE);
		body = Buffer.from(html, "utf8");
	}
	res.writeHead(200, {
		"Content-Type": TYPES[ext] || "application/octet-stream",
		"Cache-Control": "no-store",
	});
	res.end(body);
}

http
	.createServer((req, res) => {
		const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
		let file = path.join(root, urlPath);
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
		send(res, file);
	})
	.listen(port, "127.0.0.1", () => {
		console.log("verify server on http://127.0.0.1:" + port + " root=" + root);
	});
