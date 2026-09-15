// 临时：找出「Astro 不会编译」的脚本里残留的 TS 语法。
// Astro 规则：is:inline 或带 define:vars 的 <script> 一律原样内联输出（不经过 esbuild），
// 因此其中任何 TS 语法都会在浏览器里变成 SyntaxError，整段脚本不执行。
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve("src");
const files = [];
(function walk(dir) {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) walk(p);
		else if (/\.(astro|html)$/.test(e.name)) files.push(p);
	}
})(root);

/** 从 <script 起解析开标签，正确跳过属性值里的 > （define:vars={{ a > 0 }} 会踩到朴素正则） */
function findOpenTagEnd(text, from) {
	let depth = 0;
	let quote = null;
	for (let i = from; i < text.length; i++) {
		const ch = text[i];
		if (quote) {
			if (ch === quote) quote = null;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === "`") {
			quote = ch;
			continue;
		}
		if (ch === "{" || ch === "(" || ch === "[") depth++;
		else if (ch === "}" || ch === ")" || ch === "]") depth--;
		else if (ch === ">" && depth <= 0) return i;
	}
	return -1;
}

let bad = 0;
let checked = 0;
for (const file of files) {
	const text = fs.readFileSync(file, "utf8");
	let idx = 0;
	for (;;) {
		const start = text.indexOf("<script", idx);
		if (start < 0) break;
		const tagEnd = findOpenTagEnd(text, start + 7);
		if (tagEnd < 0) break;
		const attrs = text.slice(start + 7, tagEnd);
		const bodyStart = tagEnd + 1;
		const bodyEnd = text.indexOf("</script>", bodyStart);
		if (bodyEnd < 0) break;
		const body = text.slice(bodyStart, bodyEnd);
		idx = bodyEnd + 9;

		const inlined = /\bis:inline\b/.test(attrs) || /\bdefine:vars\b/.test(attrs);
		if (!inlined) continue;
		if (/\bsrc\s*=/.test(attrs)) continue;
		if (/application\/ld\+json/.test(attrs)) continue;
		if (/is:raw/.test(attrs)) continue;

		const rel = path.relative(root, file);
		const line0 = text.slice(0, bodyStart).split("\n").length;
		checked++;
		try {
			new vm.Script(body, { filename: rel });
		} catch (e) {
			bad++;
			const tag = /\bdefine:vars\b/.test(attrs) ? "define:vars" : "is:inline";
			console.log(`!! ${rel} [${tag}] script body starts at line ${line0}: ${e.message}`);
			const m = /:(\d+)\b/.exec(String(e.stack || "").split("\n")[0]);
			if (m) {
				const lines = body.split("\n");
				const ln = Number(m[1]);
				for (let i = Math.max(0, ln - 2); i < Math.min(lines.length, ln + 1); i++) {
					console.log(`     ${i + 1}: ${lines[i].slice(0, 180)}`);
				}
			}
		}
	}
}
console.log(`\nchecked=${checked} bad=${bad}`);
