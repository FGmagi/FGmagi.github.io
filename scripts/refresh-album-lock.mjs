import fs from "node:fs";
import path from "node:path";

const infoPath = path.join(process.cwd(), "public", "images", "info.json");
const lockPath = path.join(process.cwd(), "public", "images", "remote-lock.json");
const entries = JSON.parse(fs.readFileSync(infoPath, "utf8"));
const lock = { schema: 1, refreshedAt: new Date().toISOString(), directories: {} };
const localAlbumRoot = path.join(process.cwd(), "images");

function parseGitHubDirectory(url) {
	try {
		const parsed = new URL(url);
		const parts = parsed.pathname.split("/").filter(Boolean);
		if (parsed.hostname !== "cdn.jsdelivr.net" || parts[0] !== "gh" || parts.length < 3) {
			return null;
		}
		const [owner, repoSpec, ...folder] = parts.slice(1);
		const repo = repoSpec.split("@")[0];
		const branch = repoSpec.includes("@") ? repoSpec.split("@").slice(1).join("@") : "main";
		return { owner, repo, branch, folder: folder.join("/") };
	} catch {
		return null;
	}
}

for (const entry of Array.isArray(entries) ? entries : []) {
	for (const url of entry.photo_dir_urls ?? []) {
		const directory = parseGitHubDirectory(url);
		if (!directory) continue;
		const localDirectory = path.join(
			localAlbumRoot,
			path.basename(directory.folder),
		);
		if (fs.existsSync(localDirectory)) {
			lock.directories[url] = fs
				.readdirSync(localDirectory, { withFileTypes: true })
				.filter(
					(item) =>
						item.isFile() &&
						/\.(?:avif|jpe?g|png|gif|webp)$/i.test(item.name),
				)
				.map((item) => item.name)
				.sort((a, b) => a.localeCompare(b, "zh-CN"));
			continue;
		}
		const api = `https://api.github.com/repos/${directory.owner}/${directory.repo}/contents/${directory.folder}?ref=${encodeURIComponent(directory.branch)}`;
		const response = await fetch(api, {
			headers: {
				Accept: "application/vnd.github+json",
				"User-Agent": "fgmagi-album-lock",
				...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
			},
		});
		if (!response.ok) {
			console.warn(`[album-lock] ${url}: HTTP ${response.status}`);
			continue;
		}
		const items = await response.json();
		lock.directories[url] = (Array.isArray(items) ? items : [])
			.filter((item) => item.type === "file" && /\.(?:avif|jpe?g|png|gif|webp)$/i.test(item.name))
			.map((item) => item.name)
			.sort((a, b) => a.localeCompare(b, "zh-CN"));
	}
}
fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
console.log(`[album-lock] wrote ${Object.keys(lock.directories).length} directories`);

