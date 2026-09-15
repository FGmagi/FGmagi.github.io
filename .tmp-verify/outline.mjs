// 从 dump-dom 产物里打印首页主要结构（缩进树），用于人工审阅页面组成。
import fs from "node:fs";

const file = process.argv[2] || ".tmp-verify/probe-1440.html";
let html = fs.readFileSync(file, "utf8");
html = html.replace(/<script[\s\S]*?<\/script>/g, "");
html = html.replace(/<style[\s\S]*?<\/style>/g, "");

const start = html.indexOf("<body");
if (start < 0) throw new Error("no body");

const voidTags = new Set(["img", "br", "hr", "input", "meta", "link", "source", "path", "use", "circle", "rect", "line", "polyline", "polygon", "ellipse"]);
const SKIP = new Set(["svg", "path", "defs", "symbol", "g", "use", "clipPath", "filter"]);

let depth = 0;
const tokenRe = /<(\/?)([a-zA-Z0-9:-]+)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
let out = [];
let m;
let skipDepth = 0;
let skipTag = "";
let lastIndex = 0;
let textBuf = "";

function flushText() {
	const t = textBuf.replace(/\s+/g, " ").trim();
	textBuf = "";
	if (!t || skipDepth > 0) return;
	if (t.length > 60) out.push("  ".repeat(depth) + "· " + t.slice(0, 60) + "…");
	else out.push("  ".repeat(depth) + "· " + t);
}

while ((m = tokenRe.exec(html))) {
	textBuf += html.slice(lastIndex, m.index);
	flushText();
	lastIndex = tokenRe.lastIndex;
	const [full, slash, tag, attrs, selfClose] = m;
	if (slash) {
		if (skipDepth > 0) {
			if (tag === skipTag) skipDepth--;
			continue;
		}
		depth = Math.max(0, depth - 1);
		continue;
	}
	if (skipDepth > 0) {
		if (SKIP.has(tag)) skipDepth++;
		continue;
	}
	if (SKIP.has(tag)) {
		skipDepth = 1;
		skipTag = tag;
		continue;
	}
	const id = /id="([^"]*)"/.exec(attrs);
	const cls = /class="([^"]*)"/.exec(attrs);
	const label = tag + (id ? "#" + id[1] : "") + (cls ? "." + cls[1].split(/\s+/).slice(0, 4).join(".") : "");
	out.push("  ".repeat(depth) + label);
	if (!selfClose && !voidTags.has(tag)) depth++;
}
console.log(out.join("\n"));
