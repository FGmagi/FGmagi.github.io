import fs from "node:fs";
import path from "node:path";

const dir = ".tmp-verify";
const files = process.argv.slice(2);
const list = files.length
	? files
	: fs.readdirSync(dir).filter((f) => /^report-.*\.json$/.test(f));

for (const f of list) {
	const raw = fs.readFileSync(path.join(dir, f), "utf8").replace(/^\uFEFF/, "");
	let r;
	try {
		r = JSON.parse(raw);
	} catch (e) {
		console.log(f, "PARSE FAIL", String(e).slice(0, 120));
		continue;
	}
	const num = (v) => (typeof v === "number" ? v : v);
	console.log("=".repeat(70));
	console.log(f, "| viewport", r.viewport.w + "x" + r.viewport.h, "| root", r.doc.rootFontSize);
	console.log("body:", r.bodyClass);
	console.log(
		"doc: scrollW",
		r.doc.scrollW,
		"clientW",
		r.doc.clientW,
		"scrollH",
		r.doc.scrollH,
		"| resources",
		r.resources.total,
		"| imgs",
		r.images.count,
	);
	console.log("edges:", JSON.stringify(r.edges));
	console.log("cards:", r.cards.map((c) => `${c.el} @${c.x},${c.y} ${c.w}x${c.h}`).join(" | "));
	console.log("posts:", (r.posts || []).map((p) => `${p.el} @${p.x},${p.y} ${p.w}x${p.h}`).join(" | ") || "(none)");
	console.log("sideWidgets:", (r.sideWidgets || []).map((p) => `${p.el} @${p.x},${p.y} ${p.w}x${p.h}`).join(" | "));
	console.log("pairs:", r.pairs.map((p) => `${p.name} overlap=${p.overlap} gapX=${p.gapX}`).join(" | "));
	console.log("key:", JSON.stringify(r.key));
	if (r.overflowing.length) console.log("overflowing:", JSON.stringify(r.overflowing));
	if (r.clippedText.length) console.log("clipped:", JSON.stringify(r.clippedText));
	if (r.images.broken.length) console.log("brokenImgs:", JSON.stringify(r.images.broken));
	if (r.errors.length) console.log("errors:", JSON.stringify(r.errors));
}
