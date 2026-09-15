// 临时：语法检查所有 is:inline 内联脚本（浏览器会原样执行，任何 TS 语法都是运行时致命错误）
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

let bad = 0;
let checked = 0;
for (const file of files) {
	const text = fs.readFileSync(file, "utf8");
	const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
	let m;
	while ((m = re.exec(text))) {
		const attrs = m[1];
		const body = m[2];
		const isInline = /\bis:inline\b/.test(attrs);
		if (!isInline) continue;
		if (/\bsrc\s*=/.test(attrs)) continue;
		if (/application\/ld\+json/.test(attrs)) continue;
		const line0 = text.slice(0, m.index).split("\n").length;
		checked++;
		try {
			new vm.Script(body, { filename: path.relative(root, file) });
		} catch (e) {
			bad++;
			const rel = path.relative(root, file);
			console.log(`SYNTAX ERROR ${rel} (script starts line ${line0}): ${e.message}`);
			const sm = /(\d+)/.exec(e.stack?.split("\n")[0] || "");
			if (sm) {
				const ln = Number(sm[1]);
				const lines = body.split("\n");
				for (let i = Math.max(0, ln - 3); i < Math.min(lines.length, ln + 2); i++) {
					console.log(`   ${i + 1}: ${lines[i].slice(0, 200)}`);
				}
			}
		}
	}
}
console.log(`\nchecked=${checked} bad=${bad}`);
