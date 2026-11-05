import fs from "node:fs";
import path from "node:path";

const apply = process.argv.includes("--apply");
const sourceRoots = [
	path.join(process.cwd(), "src"),
	path.join(process.cwd(), "scripts"),
	path.join(process.cwd(), "public", "js"),
	path.join(process.cwd(), ".github"),
];
const extraFiles = [path.join(process.cwd(), "astro.config.mjs")];
const logPath = path.join(process.cwd(), "任务日志.log");
const dateAnywherePattern = /(?:26|2026)[./-]\d{1,2}[./-]\d{1,2}\b/;
const extensions = new Set([
	".astro",
	".css",
	".js",
	".mjs",
	".svelte",
	".styl",
	".ts",
]);

function walk(directory, files = []) {
	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		const full = path.join(directory, entry.name);
		if (entry.isDirectory()) walk(full, files);
		else if (extensions.has(path.extname(entry.name))) files.push(full);
	}
	return files;
}

function categoryName(file) {
	const relative = path.relative(process.cwd(), file).replaceAll("\\", "/");
	if (/Wallpaper|Banner|wallpaper|banner/i.test(relative)) return "01 壁纸与横幅";
	if (/layout-responsive|variables|Navbar|MainGridLayout|widget-responsive|mobile-navbar/i.test(relative))
		return "02 布局、宽度与响应式";
	if (/page-transition|motion|transition|PostCard|PostPage|PostMeta|card-filter|PostSearchBar/i.test(relative))
		return "03 页面转场、卡片与动效";
	if (/pages\/|components\/posts|lib\/content|content-utils|url-utils|permalinks?/i.test(relative))
		return "04 文章、路由与内容";
	if (/album|photo|image|media|masonry/i.test(relative)) return "05 相册、图片与媒体";
	if (/Search|Archive|calendar/i.test(relative)) return "06 搜索、归档与日历";
	if (/anime|friend|devices|diary|timeline/i.test(relative)) return "07 番剧、友链与功能页";
	if (/setting|settings|DisplaySettings|theme|Config|config/i.test(relative))
		return "08 设置、主题与配置";
	if (/icon|font|analytics|integrations/i.test(relative)) return "09 图标、字体与第三方加载";
	if (/scripts\/|panel-manager|toc-layout|widget-manager|sakura/i.test(relative))
		return "10 客户端运行时与导航";
	return "11 其他实现与维护";
}

function isStandaloneBlock(text, start, end, open, close) {
	const lineStart = text.lastIndexOf("\n", start - 1) + 1;
	const closeLineEnd = text.indexOf("\n", end + close.length);
	const lineEnd = closeLineEnd < 0 ? text.length : closeLineEnd;
	const prefix = text.slice(lineStart, start).trim();
	const suffix = text.slice(end + close.length, lineEnd).trim();
	const jsxWrapped = open === "/*" && prefix === "{" && suffix === "}";
	return (prefix === "" || jsxWrapped) && (suffix === "" || jsxWrapped);
}

function standaloneBlocks(text, open, close, collected) {
	const spans = [];
	let cursor = 0;
	while (cursor < text.length) {
		const start = text.indexOf(open, cursor);
		if (start < 0) break;
		const end = text.indexOf(close, start + open.length);
		if (end < 0) break;
		const raw = text.slice(start + open.length, end);
		if (isStandaloneBlock(text, start, end, open, close) && dateAnywherePattern.test(raw)) {
			collected.push(text.slice(start, end + close.length).trim());
			const lineStart = text.lastIndexOf("\n", start - 1) + 1;
			let removeEnd = end + close.length;
			const prefix = text.slice(lineStart, start).trim();
			if (open === "/*" && prefix === "{" && text[removeEnd] === "}") removeEnd += 1;
			const lineEnd = text.indexOf("\n", removeEnd);
			const rest = text.slice(removeEnd, lineEnd < 0 ? text.length : lineEnd);
			if (rest.trim() === "" && (prefix === "" || prefix === "{")) {
				removeEnd = lineEnd < 0 ? text.length : lineEnd + 1;
				spans.push([lineStart, removeEnd]);
			} else {
				spans.push([start, end + close.length]);
			}
		}
		cursor = end + close.length;
	}
	return spans;
}

function stripDatedComments(text, collected) {
	const spans = [
		...standaloneBlocks(text, "/*", "*/", collected),
		...standaloneBlocks(text, "<!--", "-->", collected),
	];

	let output = text;
	for (const [start, end] of spans.sort((a, b) => b[0] - a[0])) {
		output = output.slice(0, start) + output.slice(end);
	}

	const lines = output.split(/\r?\n/);
	const kept = [];
	for (const line of lines) {
		const standalone = /^\s*\/\/\s*(.*)$/.exec(line);
		if (standalone && dateAnywherePattern.test(standalone[1])) {
			collected.push(line.trim());
			continue;
		}
		const hashComment = /^\s*#\s*(.*)$/.exec(line);
		if (hashComment && dateAnywherePattern.test(hashComment[1])) {
			collected.push(line.trim());
			continue;
		}
		const trailing = /^(.*?)\s+\/\/\s*(.*)$/.exec(line);
		if (trailing && dateAnywherePattern.test(trailing[2])) {
			collected.push(`// ${trailing[2].trim()}`);
			kept.push(trailing[1].replace(/\s+$/, ""));
			continue;
		}
		kept.push(line);
	}
	return kept.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s*$/, "\n");
}

const files = [
	...sourceRoots.flatMap((root) => (fs.existsSync(root) ? walk(root) : [])),
	...extraFiles.filter((file) => fs.existsSync(file)),
];
const archived = new Map();
let changedFiles = 0;
let commentCount = 0;

for (const file of files) {
	const before = fs.readFileSync(file, "utf8");
	const comments = [];
	const after = stripDatedComments(before, comments);
	if (after === before || comments.length === 0) continue;
	changedFiles += 1;
	commentCount += comments.length;
	const group = categoryName(file);
	if (!archived.has(group)) archived.set(group, []);
	archived.get(group).push({
		file: path.relative(process.cwd(), file).replaceAll("\\", "/"),
		comments,
	});
	if (apply) fs.writeFileSync(file, `${after.replace(/\s*$/, "")}\n`);
}

if (apply && archived.size > 0) {
	const sections = [
		"\n\n2026.11.05 [源码历史修改注释归档]",
		"[说明：以下日期型修改注释从源码移出，按功能模块集中归档；功能性 API、行为契约和必要实现说明保留在代码中。]",
	];
	for (const group of [...archived.keys()].sort()) {
		sections.push(`\n## ${group}`);
		for (const item of archived.get(group).sort((a, b) => a.file.localeCompare(b.file))) {
			sections.push(`\n### ${item.file}`);
			for (const comment of item.comments) sections.push(comment);
		}
	}
	const previousLog = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "";
	const previousMarker = previousLog.search(
		/\n\n(?:2026\.11\.05 \[代码内日期型修改注释归档\]|2026\.11\.05 \[源码历史修改注释归档\])/,
	);
	const heading = previousMarker >= 0
		? "\n\n2026.11.05 [补充迁移修改注释]"
		: sections[0];
	fs.writeFileSync(
		logPath,
		`${previousLog.trimEnd()}${heading}${sections.slice(1).join("\n")}\n`,
	);
}

console.log(
	JSON.stringify(
		{
			mode: apply ? "apply" : "dry-run",
			changedFiles,
			commentCount,
			modules: archived.size,
		},
		null,
		2,
	),
);
