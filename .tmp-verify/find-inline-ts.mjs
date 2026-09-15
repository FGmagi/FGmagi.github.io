// 临时：扫描 src 下所有 is:inline 的内联脚本，找出 JS 非法的 TS 语法（验证完成后删除）
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("src");
const files = [];
(function walk(dir) {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) walk(p);
		else if (/\.(astro|html)$/.test(e.name)) files.push(p);
	}
})(root);

const PATTERNS = [
	{ name: "as-cast", re: /\bas\s+(any|string|number|boolean|unknown|[A-Z][A-Za-z0-9_]*\b)/ },
	{ name: "type-annot", re: /(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*:\s*[A-Za-z_$]/ },
	{ name: "param-annot", re: /\((?:[^()]*?)\b[a-zA-Z_$][\w$]*\s*:\s*(?:string|number|boolean|any|[A-Z][A-Za-z0-9_]*)\b/ },
	{ name: "iface", re: /\b(interface|type)\s+[A-Z][A-Za-z0-9_]*\s*(=|\{)/ },
	{ name: "nonnull", re: /[A-Za-z_$)\]]!\s*[.;,)\[]/ },
];

let hits = 0;
for (const file of files) {
	const text = fs.readFileSync(file, "utf8");
	const re = /<script\b([^>]*)>/gi;
	let m;
	while ((m = re.exec(text))) {
		const attrs = m[1];
		if (!/is:inline/.test(attrs)) continue;
		const start = m.index + m[0].length;
		const end = text.indexOf("</script>", start);
		if (end < 0) continue;
		const body = text.slice(start, end);
		const line0 = text.slice(0, start).split("\n").length;
		for (const p of PATTERNS) {
			const mm = p.re.exec(body);
			if (!mm) continue;
			const line = line0 + body.slice(0, mm.index).split("\n").length - 1;
			const snippet = body
				.slice(Math.max(0, mm.index - 60), mm.index + 80)
				.replace(/\s+/g, " ");
			console.log(`${path.relative(root, file)}:${line} [${p.name}] ...${snippet}...`);
			hits++;
		}
	}
}
console.log(`\ntotal hits: ${hits}`);
