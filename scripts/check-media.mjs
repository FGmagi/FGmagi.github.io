import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const manifestPath = path.join(root, "src", "generated", "media-manifest.json");
if (!fs.existsSync(manifestPath)) {
	throw new Error("media manifest missing; run pnpm media:build");
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (manifest.schema !== 1 || !manifest.albums) {
	throw new Error("unsupported media manifest schema");
}
let failures = 0;
let checked = 0;
for (const [album, records] of Object.entries(manifest.albums)) {
	for (const record of records) {
		for (const variant of record.webp ?? []) {
			checked += 1;
			const file = path.join(root, "public", variant.url.replace(/^\//, ""));
			if (!fs.existsSync(file)) {
				console.error(`[media:check] missing ${album}/${record.fileName} -> ${variant.url}`);
				failures += 1;
				continue;
			}
			const meta = await sharp(file).metadata();
			if (!meta.width || !meta.height) {
				console.error(`[media:check] invalid ${variant.url}`);
				failures += 1;
			}
		}
		if (!record.width || !record.height) {
			console.error(`[media:check] missing dimensions ${album}/${record.fileName}`);
			failures += 1;
		}
	}
}
for (const [source, record] of Object.entries(manifest.posts ?? {})) {
	for (const variant of record.webp ?? []) {
		checked += 1;
		const file = path.join(root, "public", variant.url.replace(/^\//, ""));
		if (!fs.existsSync(file)) {
			console.error(`[media:check] missing ${source} -> ${variant.url}`);
			failures += 1;
			continue;
		}
		const meta = await sharp(file).metadata();
		if (!meta.width || !meta.height) {
			console.error(`[media:check] invalid ${variant.url}`);
			failures += 1;
		}
	}
}
if (failures) process.exitCode = 1;
else console.log(`[media:check] ${checked} variants valid`);

