// 临时：解析 harness 报告（验证完成后删除）
import fs from "node:fs";
const raw = fs.readFileSync(process.argv[2], "utf8");
const rep = JSON.parse(raw.replace(/^\uFEFF/, ""));

const BODY_CLASSES = [
	"page-prerender",
	"page-entering",
	"swup-leaving",
	"lg:is-home",
	"wallpaper-transparent",
	"no-banner-mode",
	"simple-mode",
	"enable-banner",
];
const interesting = (a) => BODY_CLASSES.some((c) => a.split(/\s+/).includes(c));

console.log("clickedHref:", rep.clickedHref);
console.log("DIAG:", JSON.stringify(rep.diag, null, 1));
console.log("errors:", JSON.stringify(rep.errors));

for (const ph of rep.phases) {
	console.log("\n########## " + ph.name + " ##########");
	if (ph.swup !== undefined) console.log("swup:", ph.swup);
	if (ph.snap) console.log("  start-state:", JSON.stringify(ph.snap));

	if (ph.calls) {
		const hits = ph.calls.filter((c) => interesting(c.a));
		console.log(`--- body 相关 classList 调用（${hits.length} 条）---`);
		hits.forEach((c) => console.log(`  t=${String(c.t).padStart(6)} ${c.m}(${c.a})`));
	}

	if (ph.frames && ph.frames.length) {
		console.log(`--- 逐帧（共 ${ph.frames.length} 帧；仅打印状态变化帧）---`);
		let prev = null;
		ph.frames.forEach((f) => {
			const k = [f.cls, f.g, f.c, f.r, f.n].join("|");
			if (k !== prev) {
				console.log(`  t=${String(f.t).padStart(6)} cls="${f.cls}" grid=${f.g} toc=${f.c} rail=${f.r} entries=${f.n}`);
				prev = k;
			}
		});
	}
	if (ph.settled) console.log("  settled:", JSON.stringify(ph.settled));
}
