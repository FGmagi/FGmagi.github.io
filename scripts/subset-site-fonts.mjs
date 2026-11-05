import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Fontmin = require("fontmin");
const root = process.cwd();
const fontDir = path.join(root, "public", "assets", "font");
const texts = new Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789，。！？；：（）【】《》、·—…“”‘’ ");

function collect(directory) {
	if (!fs.existsSync(directory)) return;
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		const full = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			collect(full);
			continue;
		}
		if (!/\.(?:md|astro|svelte|ts|js|mjs|json)$/i.test(entry.name)) continue;
		const text = fs.readFileSync(full, "utf8");
		for (const char of text) texts.add(char);
	}
}

collect(path.join(root, "src"));
collect(path.join(root, "public", "data"));
const glyphs = Array.from(texts).join("");

for (const name of fs.readdirSync(fontDir)) {
	if (!/\.ttf$/i.test(name)) continue;
	const source = path.join(fontDir, name);
	const target = path.join(fontDir, name.replace(/\.ttf$/i, ".woff2"));
	if (fs.existsSync(target) && fs.statSync(target).mtimeMs >= fs.statSync(source).mtimeMs) {
		continue;
	}
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fgmagi-font-"));
	await new Promise((resolve, reject) => {
		new Fontmin()
			.src(source)
			.use(Fontmin.glyph({ text: glyphs, hinting: false }))
			.use(Fontmin.ttf2woff2({ deflate: true }))
			.dest(tempDir)
			.run((error) => (error ? reject(error) : resolve()));
	});
	fs.copyFileSync(path.join(tempDir, path.basename(target)), target);
	fs.rmSync(tempDir, { recursive: true, force: true });
	console.log(`[fonts] ${name} -> ${path.basename(target)}`);
}

