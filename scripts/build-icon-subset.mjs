import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourceRoot = path.join(root, "src");
const output = path.join(sourceRoot, "generated", "iconify-subset.json");
const supported = new Set([
	"material-symbols",
	"fa6-solid",
	"fa6-regular",
	"fa6-brands",
	"simple-icons",
	"mdi",
]);
const names = new Map();

function walk(directory) {
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		const full = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "generated") continue;
			walk(full);
			continue;
		}
		if (!/\.(?:astro|svelte|ts|js|mjs)$/i.test(entry.name)) continue;
		const text = fs.readFileSync(full, "utf8");
		const regex =
			/(?:material-symbols|fa6-solid|fa6-regular|fa6-brands|simple-icons|mdi):[a-z0-9-]+/gi;
		for (const match of text.matchAll(regex)) {
			const [prefix, name] = match[0].split(":");
			if (!supported.has(prefix)) continue;
			if (!names.has(prefix)) names.set(prefix, new Set());
			names.get(prefix).add(name);
		}
	}
}

walk(sourceRoot);
const sets = {};
for (const [prefix, wanted] of names) {
	const file = path.join(
		root,
		"node_modules",
		"@iconify-json",
		prefix,
		"icons.json",
	);
	if (!fs.existsSync(file)) continue;
	const full = JSON.parse(fs.readFileSync(file, "utf8"));
	const icons = {};
	for (const name of wanted) {
		if (full.icons?.[name]) icons[name] = full.icons[name];
		if (full.aliases?.[name]) icons[name] = full.aliases[name];
	}
	sets[prefix] = {
		prefix,
		info: full.info,
		metadata: full.metadata,
		icons,
	};
}

fs.mkdirSync(path.dirname(output), { recursive: true });
const body = `${JSON.stringify({ schema: 1, sets }, null, 2)}\n`;
const current = fs.existsSync(output) ? fs.readFileSync(output, "utf8") : "";
if (current !== body) fs.writeFileSync(output, body);
const count = Object.values(sets).reduce(
	(sum, set) => sum + Object.keys(set.icons).length,
	0,
);
console.log(`[icons] ${count} local icons across ${Object.keys(sets).length} sets`);

