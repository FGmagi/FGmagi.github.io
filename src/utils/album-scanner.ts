import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { dataFiles } from "../config";
import type { AlbumGroup, Photo } from "../types/album";
import {
	ALBUM_COVER_NAME_PREFIX,
	ALBUM_DEFAULT_COLUMNS,
	ALBUM_DEFAULT_LAYOUT,
	ALBUM_MAX_COLUMNS,
	ALBUM_MIN_COLUMNS,
} from "../types/album";

// 26.09.02 [9]：photo_dir_urls 兼容旧单数键 photo_dir_url（string|string[]，scanner 归一读取并 warn 迁移提示）。
// 26.09.02 [8]：相册模块改造——albumsDir/info.json 改为顶层对象数组（每对象一个相册），
// 新增外链能力：photo_urls（外链单图 url 数组）与 photo_dir_urls（外链图片文件夹 url 数组，
// 构建期自动读取其下图片直链）。仍完整保留既有 per-folder 对象模式：根 info.json 缺失或非数组时回退。
// 26.09.02 [7]：相册目录改读 config（dataFiles.albumsDir）

// 图片扩展名白名单（本地文件夹 / 外链目录扫描一致）
const PHOTO_EXTENSIONS = [
	".jpg",
	".jpeg",
	".png",
	".gif",
	".webp",
	".svg",
	".avif",
	".bmp",
	".tiff",
	".tif",
];
// 图片直链结尾匹配（外链目录索引的 href/src 里挑出图片，忽略 ?query / #hash）
const IMAGE_URL_EXT_REGEX =
	/\.(jpg|jpeg|png|gif|webp|svg|avif|bmp|tiff|tif)(?:[?#].*)?$/i;
// 外链抓取并发上限与单次请求超时
const MAX_REMOTE_CONCURRENCY = 6;
const REMOTE_TIMEOUT_MS = 15000;
// 两上限兜底默认值（与 src/config.ts 注释一致）
const DEFAULT_MAX_IMAGES_PER_FOLDER = 500;
const DEFAULT_MAX_ALBUM_SIZE_BYTES = 1073741824; // 1GB

// 无可用封面时的白色占位图网页 URL。映射 dataFiles.white_webp 的“文件系统路径”为“网页 URL”：
// 该值须指向 public/ 下某资源（如 "public/images/white_webp"），剥掉开头 "public/"（或 "public\"）、
// 前面补 "/"，若末尾无扩展名则补 ".webp"，得到 "/images/white_webp.webp"。值已带扩展名则不重复补。
const WHITE_COVER_PLACEHOLDER_URL = (() => {
	const raw = dataFiles.white_webp.trim();
	const withoutPublic =
		raw.startsWith("public/") || raw.startsWith("public\\")
			? raw.slice("public".length)
			: raw;
	const withSlash = withoutPublic.startsWith("/")
		? withoutPublic
		: "/" + withoutPublic;
	const ext = path.extname(withSlash);
	return /^\.[^/\\]+$/.test(ext) ? withSlash : `${withSlash}.webp`;
})();

const DEFAULT_DATE = () => new Date().toISOString().split("T")[0];

export async function scanAlbums(): Promise<AlbumGroup[]> {
	const albumsDir = path.join(process.cwd(), dataFiles.albumsDir);
	const albums: AlbumGroup[] = [];

	// 检查目录是否存在
	if (!fs.existsSync(albumsDir)) {
		console.warn("相册目录不存在:", albumsDir);
		return [];
	}

	// [数组模式优先] 尝试读取 albumsDir/info.json 顶层数组
	const infoFileName = dataFiles.albumsInfoFile || "info.json";
	const rootInfoPath = path.join(albumsDir, infoFileName);
	if (fs.existsSync(rootInfoPath)) {
		try {
			const parsed = JSON.parse(fs.readFileSync(rootInfoPath, "utf-8"));
			if (Array.isArray(parsed)) {
				return await scanAlbumsFromRootArray(albumsDir, parsed);
			}
			console.warn(
				`相册清单 ${infoFileName} 不是顶层数组，回退到 per-folder 扫描模式`,
			);
		} catch (e) {
			console.error(
				`相册清单 ${infoFileName} 解析失败，回退到 per-folder 扫描模式:`,
				e,
			);
		}
	}

	// [回退 per-folder] 兼容旧的对象模式（原 scanAlbums 逻辑）：每个子文件夹一个相册
	const albumFolders = fs
		.readdirSync(albumsDir, { withFileTypes: true })
		.filter((dirent) => dirent.isDirectory())
		.map((dirent) => dirent.name);

	// 处理每个相册文件夹
	for (const folder of albumFolders) {
		const albumPath = path.join(albumsDir, folder);
		const album = await processAlbumFolder(albumPath, folder);
		if (album) {
			albums.push(album);
		}
	}

	return albums;
}

// ===========================================================================
// 数组模式：albumsDir/info.json 顶层对象数组 → 每对象一个相册
// ===========================================================================
async function scanAlbumsFromRootArray(
	albumsDir: string,
	entries: unknown[],
): Promise<AlbumGroup[]> {
	const usedIds = new Set<string>();
	const albums: AlbumGroup[] = [];

	for (let idx = 0; idx < entries.length; idx++) {
		const raw = entries[idx];
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;

		const album = await buildAlbumFromRootEntry(
			albumsDir,
			raw as Record<string, any>,
			idx,
		);
		if (!album) continue;

		// 对 id 冲突去重（追加 -n 后缀保持唯一 URL）
		let id = album.id;
		if (usedIds.has(id)) {
			let n = 2;
			while (usedIds.has(`${id}-${n}`)) n++;
			id = `${id}-${n}`;
			album.id = id;
		}
		usedIds.add(id);
		albums.push(album);
	}

	return albums;
}

// 归一读取外链图片文件夹 url：复数键 photo_dir_urls 为主，兼容旧单数键 photo_dir_url
// （两者均可为 string | string[]），合并去重并保持顺序；命中单数键时 warn 提示迁移。
function collectDirUrlStrings(entry: Record<string, any>): string[] {
	const out: string[] = [];
	const add = (v: unknown): void => {
		if (typeof v === "string") {
			const s = v.trim();
			if (s && !out.includes(s)) out.push(s);
		} else if (Array.isArray(v)) {
			v.forEach(add);
		}
	};
	add(entry.photo_dir_urls);
	if (entry.photo_dir_url !== undefined) {
		console.warn(
			"外链文件夹字段 photo_dir_url 已弃用，请改用复数 photo_dir_urls（scanner 已兼容读取）",
		);
		add(entry.photo_dir_url);
	}
	return out;
}

async function buildAlbumFromRootEntry(
	albumsDir: string,
	entry: Record<string, any>,
	index: number,
): Promise<AlbumGroup | null> {
	// hidden=true → 不渲染
	if (entry.hidden === true) {
		console.log(`相册清单第 ${index + 1} 项已设置为隐藏，跳过显示`);
		return null;
	}

	// title 数组模式必填（本地源=albumsDir/<title> 子文件夹，故 title 即文件夹名）；空则跳过
	const rawTitle = typeof entry.title === "string" ? entry.title.trim() : "";
	if (!rawTitle) {
		console.warn(`相册清单第 ${index + 1} 项缺少 title（必填），已跳过`);
		return null;
	}
	const title = rawTitle;

	// 本地源：albumsDir/<title> 存在且为目录才读取
	const localFolderPath = path.join(albumsDir, title);
	const hasLocalFolder =
		fs.existsSync(localFolderPath) &&
		fs.statSync(localFolderPath).isDirectory();
	// id：有匹配本地子文件夹时用文件夹名（保 URL 稳定），否则用 title 的 ascii slug
	let id = hasLocalFolder ? title : toAsciiSlug(title);
	if (!id) id = `album-${index + 1}`;
	id = toSafeSegment(id);

	const maxImagesPerFolder =
		dataFiles.albumsMaxImagesPerExternalFolder ??
		DEFAULT_MAX_IMAGES_PER_FOLDER;
	const maxAlbumSizeBytes =
		dataFiles.albumsMaxAlbumSizeBytes ?? DEFAULT_MAX_ALBUM_SIZE_BYTES;

	// 三来源可同时生效、均保留同名照片（不按文件名去重）：
	//   1) 本地图片：albumsDir/<title> 子文件夹内全部图片
	//   2) photo_urls：每条 http(s) 外链单图 url
	//   3) photo_dir_urls：每个外链图片文件夹（构建期 fetch 索引解析出图片直链）
	const photos: Photo[] = [];

	if (hasLocalFolder) {
		photos.push(...scanLocalFolderPhotos(localFolderPath, id));
	}

	const photoUrls = Array.isArray(entry.photo_urls) ? entry.photo_urls : [];
	let droppedUrls = 0;
	photoUrls.forEach((u, i) => {
		if (typeof u === "string" && isHttpUrl(u)) {
			photos.push(makeUrlPhoto(u.trim(), id, `photo-${i}`));
		} else {
			droppedUrls++;
		}
	});
	if (droppedUrls > 0) {
		console.warn(
			`相册 ${id} 有 ${droppedUrls} 条 photo_urls 非 http(s) 地址，已跳过`,
		);
	}

	const photoDirUrls = collectDirUrlStrings(entry);
	const dirFolderPhotos = await mapLimit(
		photoDirUrls,
		MAX_REMOTE_CONCURRENCY,
		async (dirUrl, i) => {
			if (typeof dirUrl !== "string" || !isHttpUrl(dirUrl)) {
				console.warn(
					`相册 ${id} 的外链文件夹不是 http(s) 地址，已跳过: ${dirUrl}`,
				);
				return [] as Photo[];
			}
			return fetchPhotoDirUrl(dirUrl.trim(), id, i, maxImagesPerFolder);
		},
	);
	for (const arr of dirFolderPhotos) photos.push(...arr);

	// 逐张计算去重键后按 hash 去重（重复项隐藏/剔除，保留首个）。
	// 注：外链不下载内容故以规范化 URL 为键去重——这是懒加载 / 防流量的折衷。
	const deduped = dedupePhotos(photos);

	// 计算后无图片 → 不渲染
	if (deduped.length === 0) {
		console.warn(`相册 ${id} 计算后无可用照片，跳过显示`);
		return null;
	}

	// 单相册大小上限（本地用 fs.stat 累加字节；外链 fetch HEAD content-length 尽力而为，失败 warn 不计）
	const finalPhotos = await enforceAlbumSizeLimit(
		deduped,
		id,
		maxAlbumSizeBytes,
		localFolderPath,
	);
	if (finalPhotos.length === 0) {
		console.warn(`相册 ${id} 超过体积上限后无剩余照片，跳过显示`);
		return null;
	}

	// 封面：显式 http 直链 → 本地 cover 文件 / 外链文件名匹配；均未命中 → 白色占位（不再回退首张照片）
	const cover = resolveCover(
		localFolderPath,
		hasLocalFolder,
		id,
		entry.cover,
		finalPhotos,
	);

	return {
		id,
		title,
		description:
			typeof entry.description === "string" ? entry.description : "",
		cover,
		date:
			typeof entry.date === "string" &&
			/^\d{4}-\d{2}-\d{2}$/.test(entry.date)
				? entry.date
				: DEFAULT_DATE(),
		location: typeof entry.location === "string" ? entry.location : "",
		tags: Array.isArray(entry.tags) ? entry.tags.map(String) : [],
		layout: entry.layout === "masonry" ? "masonry" : ALBUM_DEFAULT_LAYOUT,
		columns: clampColumns(entry.columns),
		photos: finalPhotos,
	};
}

// 本地文件夹图片扫描（数组模式）：含内容 md5 去重键
function scanLocalFolderPhotos(folderPath: string, albumId: string): Photo[] {
	const photos: Photo[] = [];
	let files: string[] = [];
	try {
		files = fs.readdirSync(folderPath);
	} catch (e) {
		console.warn(`读取本地相册文件夹失败: ${folderPath}`, e);
		return photos;
	}

	const imageFiles = files.filter((file) => isImageFile(file));
	imageFiles.forEach((file, index) => {
		const filePath = path.join(folderPath, file);
		let stats: fs.Stats;
		try {
			stats = fs.statSync(filePath);
		} catch {
			return;
		}
		const { baseName, tags } = parseFileName(file);
		photos.push({
			id: `${albumId}-photo-${index}`,
			src: `${dataFiles.albumsWebDir}/${albumId}/${file}`,
			alt: baseName,
			title: baseName,
			tags,
			date: stats.mtime.toISOString().split("T")[0],
			hash: fileContentMd5(filePath),
		});
	});
	return photos;
}

function fileContentMd5(filePath: string): string {
	try {
		const buf = fs.readFileSync(filePath);
		return crypto.createHash("md5").update(buf).digest("hex");
	} catch (e) {
		console.warn("读取图片计算 hash 失败:", filePath, e);
		return `file:${filePath}`;
	}
}

// 外链单图/文件夹图片 → Photo（不下载，只记 src，去重键=规范化 URL）
function makeUrlPhoto(url: string, albumId: string, suffix: string): Photo {
	const name = remoteName(url);
	return {
		id: `${albumId}-external-photo-${suffix}`,
		src: url,
		alt: name || `Photo ${suffix}`,
		title: name || undefined,
		date: DEFAULT_DATE(),
		hash: normalizeUrlKey(url),
	};
}

function remoteName(url: string): string {
	const clean = url.split(/[?#]/)[0];
	const seg = clean.split("/").filter(Boolean).pop() || "";
	let decoded = seg;
	try {
		decoded = decodeURIComponent(seg);
	} catch {
		/* 保留原值 */
	}
	const ext = path.extname(decoded);
	return ext ? path.basename(decoded, ext) : path.basename(decoded);
}

// 外链图片文件夹（两阶段）：
//   阶段1) GitHub / jsDelivr 文件夹识别 → GitHub Contents API 枚举文件名 → 生成 jsDelivr 单文件直链。
//   阶段2) 非 GitHub 表单或枚举失败 → 回退 HTML 目录索引解析（403/无目录索引→跳过并 warn；超上限截断）。
// 说明：jsDelivr 整仓 >50MB 只影响 data 列表 API（data.jsdelivr.com → 403），单文件直链
// cdn.jsdelivr.net/gh 不受整仓体积限制；jsDelivr 不提供目录列表，故须经 GitHub Contents API 拿文件名。
async function fetchPhotoDirUrl(
	dirUrl: string,
	albumId: string,
	dirIndex: number,
	maxImages: number,
): Promise<Photo[]> {
	// 阶段1：GitHub 文件夹枚举 → jsDelivr 单文件直链
	const enumerated = await enumerateGitHubFolderFiles(dirUrl);
	if (enumerated) {
		const found = enumerated.urls;
		if (found.length === 0) {
			console.warn(
				`相册 ${albumId} GitHub 目录 ${dirUrl} 未枚举到图片文件，跳过`,
			);
			return [];
		}
		const list = found.slice(0, maxImages);
		if (found.length > maxImages) {
			console.warn(
				`相册 ${albumId} GitHub 目录 ${dirUrl} 图片数 ${found.length} 超上限 ${maxImages}，已截断`,
			);
		}
		return list.map((u, i) =>
			makeUrlPhoto(u, albumId, `dir-${dirIndex}-${i}`),
		);
	}

	// 阶段2（回退）：HTML 目录索引解析
	let html = "";
	try {
		const res = await fetchWithTimeout(dirUrl);
		if (!res || !res.ok) {
			console.warn(
				`相册 ${albumId} 无法读取外链文件夹索引（HTTP ${res ? res.status : "?"}）: ${dirUrl}`,
			);
			return [];
		}
		html = await res.text();
	} catch (e) {
		console.warn(
			`相册 ${albumId} 外链文件夹抓取失败（已跳过）: ${dirUrl}`,
			e instanceof Error ? e.message : e,
		);
		return [];
	}

	const base = new URL(dirUrl);
	const found: string[] = [];
	const attrRe = /(?:href|src)\s*=\s*["']([^"']+)["']/gi;
	let m: RegExpExecArray | null;
	while ((m = attrRe.exec(html))) {
		const val = m[1].trim();
		if (!val || !isImageUrl(val)) continue;
		let abs: string | null = null;
		try {
			abs = new URL(val, base).href;
		} catch {
			abs = null;
		}
		if (abs && !found.includes(abs)) found.push(abs);
	}

	if (found.length === 0) {
		console.warn(
			`相册 ${albumId} 外链文件夹未解析到图片直链（403/无目录索引/非列表页）: ${dirUrl}`,
		);
		return [];
	}

	const list = found.slice(0, maxImages);
	if (found.length > maxImages) {
		console.warn(
			`相册 ${albumId} 外链文件夹 ${dirUrl} 图片数 ${found.length} 超上限 ${maxImages}，已截断`,
		);
	}
	return list.map((u, i) => makeUrlPhoto(u, albumId, `dir-${dirIndex}-${i}`));
}

// GitHub 文件夹 URL 规约结果
interface GitHubFolderSpec {
	owner: string;
	repo: string;
	/** 派生不出分支时为 undefined，交由 resolveDefaultBranch 回退 */
	branch?: string;
	/** 已解码、规范化（去掉空/./.. 段）的目录相对路径，段间用 "/" 连接 */
	folderPath: string;
}

// owner/repo 命名段校验：非空、不得为 "." / ".."、不得含路径穿越
function isPlainSegment(s: unknown): s is string {
	return (
		typeof s === "string" &&
		s.length > 0 &&
		s !== "." &&
		s !== ".." &&
		!s.includes("\\")
	);
}

// 目录相对路径各段：过滤空 / "." / ".."（路径穿越防御）
function cleanFolderSegments(parts: string[]): string {
	return parts.filter((s) => s !== "" && s !== "." && s !== "..").join("/");
}

// 识别并规约 GitHub / jsDelivr 的文件夹 URL（纯字符串，不发起网络）。识别失败返回 null（交 HTML 回退）。
export function parseGitHubFolderUrl(url: string): GitHubFolderSpec | null {
	const trimmed = url.trim();
	// WHATWG URL 会先把路径里的 "../" 规约掉，导致 owner/repo 段错位甚至越界；
	// 因此在 new URL 之前先从原始路径检测并拒绝路径穿越（"." / ".." 作独立段）。
	const rawPathOnly = trimmed.split(/[?#]/)[0];
	if (/(^|\/)(\.\.?)(\/|$)/.test(rawPathOnly)) return null;

	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		return null;
	}
	const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
	let rawPath: string;
	try {
		rawPath = decodeURIComponent(parsed.pathname);
	} catch {
		rawPath = parsed.pathname;
	}
	// 保留空段做位置索引；原始路径必须以 "/" 开头（split 后首段为空）
	const parts = rawPath.split("/");

	if (host === "api.github.com") {
		// api.github.com/repos/<owner>/<repo>/contents/<path>[?ref=<branch>]
		if (
			parts[1] !== "repos" ||
			parts.length < 5 ||
			parts[4] !== "contents"
		) {
			return null;
		}
		const owner = parts[2];
		const repo = parts[3];
		if (!isPlainSegment(owner) || !isPlainSegment(repo)) return null;
		const folderPath = cleanFolderSegments(parts.slice(5));
		const ref = parsed.searchParams.get("ref");
		return {
			owner,
			repo,
			...(ref ? { branch: ref } : {}),
			folderPath,
		};
	}

	if (host === "github.com") {
		// github.com/<owner>/<repo>[/(tree|blob)/<branch>/<path>]
		const owner = parts[1];
		const repo = parts[2];
		if (!isPlainSegment(owner) || !isPlainSegment(repo)) return null;
		if (parts.length === 3) {
			return { owner, repo, folderPath: "" };
		}
		if (parts[3] !== "tree" && parts[3] !== "blob") return null;
		const branch = parts[4];
		if (!isPlainSegment(branch)) return null;
		return {
			owner,
			repo,
			branch,
			folderPath: cleanFolderSegments(parts.slice(5)),
		};
	}

	if (host === "raw.githubusercontent.com") {
		// raw.githubusercontent.com/<owner>/<repo>/<branch>/<path>
		const owner = parts[1];
		const repo = parts[2];
		const branch = parts[3];
		if (
			!isPlainSegment(owner) ||
			!isPlainSegment(repo) ||
			!isPlainSegment(branch)
		) {
			return null;
		}
		return {
			owner,
			repo,
			branch,
			folderPath: cleanFolderSegments(parts.slice(4)),
		};
	}

	if (host === "cdn.jsdelivr.net") {
		// cdn.jsdelivr.net/gh/<owner>/<repo>[@<branch>]/<path>
		if (parts[1] !== "gh") return null;
		const owner = parts[2];
		if (!isPlainSegment(owner)) return null;
		// repo 段可带 @branch（如 FGmagi.github.io 或 FGmagi.github.io@main）
		const repoSpec = parts[3];
		if (!repoSpec) return null;
		const at = repoSpec.indexOf("@");
		const repo = at === -1 ? repoSpec : repoSpec.slice(0, at);
		if (!isPlainSegment(repo)) return null;
		const branch = at === -1 ? undefined : repoSpec.slice(at + 1);
		return {
			owner,
			repo,
			...(branch ? { branch } : {}),
			folderPath: cleanFolderSegments(parts.slice(4)),
		};
	}

	return null;
}

// 分支未指定时查询仓库默认分支；失败 warn 回退 "main"
async function resolveDefaultBranch(
	owner: string,
	repo: string,
): Promise<string> {
	const apiUrl = `https://api.github.com/repos/${owner}/${repo}`;
	const res = await fetchWithTimeout(apiUrl, {
		headers: { "User-Agent": "fgmagi-album-scanner" },
	});
	if (res && res.ok) {
		try {
			const data = await res.json();
			if (
				data &&
				typeof data === "object" &&
				typeof (data as Record<string, any>).default_branch ===
					"string" &&
				(data as Record<string, any>).default_branch
			) {
				return (data as Record<string, any>).default_branch as string;
			}
		} catch {
			/* 落入 warn 回退 */
		}
	}
	console.warn(
		`GitHub 仓库 ${owner}/${repo} 默认分支查询失败，回退 "main"（HTTP ${res ? res.status : "?"}）`,
	);
	return "main";
}

// GitHub 文件夹 → GitHub Contents API 枚举图片文件名 → 产出 jsDelivr 单文件直链。
// 识别失败或 API 失败返回 null（交 HTML 回退）；枚举成功返回直链列表（可能为空数组）。
async function enumerateGitHubFolderFiles(
	url: string,
): Promise<{ urls: string[] } | null> {
	const spec = parseGitHubFolderUrl(url);
	if (!spec) return null;

	const branch =
		spec.branch ?? (await resolveDefaultBranch(spec.owner, spec.repo));
	const folderSegs = spec.folderPath.split("/").filter((s) => s.length > 0);
	const folderPathEnc = folderSegs.map(encodeURIComponent).join("/");
	const endpoint =
		`https://api.github.com/repos/${spec.owner}/${spec.repo}/contents/` +
		`${folderPathEnc ? folderPathEnc + "/" : ""}?ref=${encodeURIComponent(branch)}`;

	let items: unknown;
	try {
		const res = await fetchWithTimeout(endpoint, {
			headers: {
				"User-Agent": "fgmagi-album-scanner",
				Accept: "application/vnd.github+json",
			},
		});
		if (!res || !res.ok) {
			console.warn(
				`相册 GitHub 目录枚举失败（HTTP ${res ? res.status : "?"}），回退 HTML 解析: ${url}`,
			);
			return null;
		}
		items = await res.json();
	} catch (e) {
		console.warn(
			`相册 GitHub 目录枚举异常（回退 HTML 解析）: ${url}`,
			e instanceof Error ? e.message : e,
		);
		return null;
	}

	if (!Array.isArray(items)) {
		console.warn(`相册 GitHub 目录枚举响应非数组，回退 HTML 解析: ${url}`);
		return null;
	}

	const seen = new Set<string>();
	const urls: string[] = [];
	for (const item of items) {
		if (!item || typeof item !== "object") continue;
		const rec = item as Record<string, any>;
		if (rec.type !== "file") continue; // 只取文件，忽略子目录
		const rawName = typeof rec.name === "string" ? rec.name : "";
		if (!rawName) continue;
		// 先解码防二次编码（中文名），再用原始 name 去重避免重名
		let name = rawName;
		try {
			name = decodeURIComponent(rawName);
		} catch {
			/* 保持原值 */
		}
		if (seen.has(rawName)) continue;
		seen.add(rawName);
		if (!isImageFile(name)) continue;
		// 显式带 branch 的 jsDelivr 单文件直链（不受整仓 >50MB 限制）
		const filePathEnc = folderPathEnc
			? `${folderPathEnc}/${encodeURIComponent(name)}`
			: encodeURIComponent(name);
		urls.push(
			`https://cdn.jsdelivr.net/gh/${spec.owner}/${spec.repo}@${encodeURIComponent(branch)}/${filePathEnc}`,
		);
	}
	return { urls };
}

// 按 hash 去重（保留首个）
function dedupePhotos(photos: Photo[]): Photo[] {
	const seen = new Set<string>();
	const out: Photo[] = [];
	let removed = 0;
	for (const p of photos) {
		const key = p.hash || normalizeUrlKey(p.src);
		if (seen.has(key)) {
			removed++;
			continue;
		}
		seen.add(key);
		out.push(p);
	}
	if (removed > 0) {
		console.warn(`相册去重：移除 ${removed} 张重复照片（重复项已隐藏）`);
	}
	return out;
}

// 单相册体积上限：从前往后累加，超出即从该位置截断（本地 fs.stat；外链 HEAD 尽力而为）
async function enforceAlbumSizeLimit(
	photos: Photo[],
	albumId: string,
	maxBytes: number,
	localFolderPath: string,
): Promise<Photo[]> {
	if (maxBytes <= 0) return photos;
	const sizes = await mapLimit(photos, MAX_REMOTE_CONCURRENCY, (p) =>
		photoByteSize(p, localFolderPath),
	);

	let total = 0;
	const kept: Photo[] = [];
	for (let i = 0; i < photos.length; i++) {
		const s = sizes[i];
		if (s !== undefined) {
			if (total + s > maxBytes) {
				console.warn(
					`相册 ${albumId} 超体积上限（约 ${Math.round((total + s) / 1048576)}MB / ${maxBytes} 字节），自第 ${i + 1} 张起截断`,
				);
				break;
			}
			total += s;
		}
		kept.push(photos[i]);
	}
	return kept;
}

async function photoByteSize(
	p: Photo,
	localFolderPath: string,
): Promise<number | undefined> {
	// 本地照片（src 形如 /images/<id>/<file>）
	if (p.src.startsWith(dataFiles.albumsWebDir + "/") && localFolderPath) {
		try {
			return fs.statSync(path.join(localFolderPath, path.basename(p.src)))
				.size;
		} catch {
			return undefined;
		}
	}
	// 外链：fetch HEAD content-length，尽力而为
	if (/^https?:/i.test(p.src)) {
		try {
			const res = await fetchWithTimeout(p.src, { method: "HEAD" });
			if (!res || !res.ok) return undefined;
			const len = res.headers.get("content-length");
			if (len === null) return undefined;
			const n = Number(len);
			return Number.isFinite(n) && n >= 0 ? n : undefined;
		} catch {
			return undefined;
		}
	}
	return undefined;
}

async function fetchWithTimeout(
	url: string,
	init?: { method?: string; headers?: Record<string, string> },
): Promise<Response | null> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);
	try {
		return await fetch(url, { ...(init || {}), signal: controller.signal });
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

// 并发受限的异步 map（结果按下标对齐；单项失败不中断整体）
async function mapLimit<T, R>(
	items: T[],
	limit: number,
	fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let cursor = 0;
	const worker = async () => {
		for (;;) {
			const i = cursor++;
			if (i >= items.length) break;
			try {
				results[i] = await fn(items[i], i);
			} catch (e) {
				results[i] = undefined as unknown as R;
				console.warn(
					"相册外链处理子项失败:",
					e instanceof Error ? e.message : e,
				);
			}
		}
	};
	const workerCount = Math.min(limit, items.length);
	await Promise.all(Array.from({ length: workerCount }, () => worker()));
	return results;
}

// 将“文件名”或“照片 src 末段”统一成封面比对键：取末段(去 ?query/#hash)、decodeURIComponent、
// 去扩展名、toLowerCase。外链照片 src 末段即 encodeURIComponent(文件名)，解码后与显式 cover 文件名可比对。
function photoNameKey(urlOrName: string): string {
	const clean = urlOrName.split(/[?#]/)[0];
	const seg = clean.split("/").filter(Boolean).pop() || "";
	let decoded = seg;
	try {
		decoded = decodeURIComponent(seg);
	} catch {
		/* 保留原值 */
	}
	const ext = path.extname(decoded);
	return (ext ? decoded.slice(0, -ext.length) : decoded).toLowerCase();
}

function resolveCover(
	localFolderPath: string,
	hasLocalFolder: boolean,
	id: string,
	explicitCover: unknown,
	photos: Photo[],
): string {
	const webPrefix = `${dataFiles.albumsWebDir}/${id}`;
	// 显式 cover 若为 http(s) 直链则直接使用（外链相册常见用法）
	const explicit =
		typeof explicitCover === "string" ? explicitCover.trim() : "";
	if (explicit && isHttpUrl(explicit)) return explicit;

	if (hasLocalFolder) {
		// 本地相册：候选=显式文件名在前 + 默认“名为 cover 的本地图片”(任意扩展名，多个取第一个)。
		// 命中即返回本地文件 web 路径；全未命中 → 末尾统一回退白色占位（不再回退首张照片）。
		const candidates: string[] = [];
		if (explicit) candidates.push(explicit);
		let localFiles: string[] = [];
		try {
			localFiles = fs.readdirSync(localFolderPath);
		} catch {
			localFiles = [];
		}
		const coverFiles = localFiles
			.filter((f) => isImageFile(f))
			.filter((f) => {
				const base = path.basename(f, path.extname(f)).toLowerCase();
				return base.startsWith(ALBUM_COVER_NAME_PREFIX);
			});
		candidates.push(...coverFiles);

		for (const name of candidates) {
			if (!name || /[/\\]/.test(name)) continue; // 拒绝含路径分隔符的封面名
			if (fs.existsSync(path.join(localFolderPath, name))) {
				return `${webPrefix}/${name}`;
			}
		}
		return WHITE_COVER_PLACEHOLDER_URL;
	}

	// 外部-only 相册（本地无同名文件夹）：仅当显式 cover 为“解码文件名”(不含路径分隔符)时，
	// 在已枚举外链照片里按序匹配（jsDelivr 直链等 src 末段即文件名）；命中返回该照片 src。
	if (explicit && !/[/\\]/.test(explicit)) {
		const key = photoNameKey(explicit);
		for (const p of photos) {
			if (photoNameKey(p.src) === key) return p.src;
		}
	}
	// 无显式 cover 或未命中 → 统一回退白色占位（不再回退首张照片、不再返回空串）
	return WHITE_COVER_PLACEHOLDER_URL;
}

function clampColumns(v: unknown): number {
	const n = typeof v === "number" ? v : Number(v);
	if (!Number.isFinite(n)) return ALBUM_DEFAULT_COLUMNS;
	return Math.min(
		ALBUM_MAX_COLUMNS,
		Math.max(ALBUM_MIN_COLUMNS, Math.round(n)),
	);
}

function isImageFile(file: string): boolean {
	return PHOTO_EXTENSIONS.includes(path.extname(file).toLowerCase());
}

function isImageUrl(url: string): boolean {
	return IMAGE_URL_EXT_REGEX.test(url);
}

function isHttpUrl(url: string): boolean {
	return /^https?:\/\//i.test(url);
}

function normalizeUrlKey(url: string): string {
	try {
		const u = new URL(url);
		u.hash = "";
		// 去掉默认端口，便于同资源 http/https 等价归并
		if (
			(u.protocol === "http:" && u.port === "80") ||
			(u.protocol === "https:" && u.port === "443")
		) {
			u.port = "";
		}
		return u.href;
	} catch {
		return url.trim();
	}
}

function toAsciiSlug(input: string): string {
	return input
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function toSafeSegment(input: string): string {
	return input.replace(/[/\\]/g, "-").replace(/\s+/g, " ").trim() || "album";
}

async function processAlbumFolder(
	folderPath: string,
	folderName: string,
): Promise<AlbumGroup | null> {
	// 检查必要文件
	const infoPath = path.join(folderPath, "info.json");

	if (!fs.existsSync(infoPath)) {
		console.warn(`相册 ${folderName} 缺少 info.json 文件`);
		return null;
	}

	// 读取相册信息
	const infoContent = fs.readFileSync(infoPath, "utf-8");
	let info: Record<string, any>;
	try {
		info = JSON.parse(infoContent);
	} catch (e) {
		console.error(`相册 ${folderName} 的 info.json 格式错误:`, e);
		return null;
	}

	// 检查是否为外链模式
	const isExternalMode = info.mode === "external";
	const isExternalAutoMode = info.mode === "external_auto";
	let photos: Photo[] = [];
	let cover: string;
	let cover_name = dataFiles.white_webp;
	if (isExternalMode) {
		// 外链模式：从 info.json 中获取封面和照片
		if (!info.cover) {
			console.warn(`相册 ${folderName} 外链模式缺少 cover 字段`);
			return null;
		}

		cover = info.cover;
		photos = processExternalPhotos(info.photos || [], folderName);
	} else if (isExternalAutoMode) {
		// 外链自动模式：从 link_src 路径自动读取所有图片
		if (!info.link_src) {
			console.warn(
				`相册 ${folderName} external_auto 模式缺少 link_src 字段`,
			);
			return null;
		}

		const linkSrc = info.link_src;
		cover_name = info.cover || cover_name;

		// 扫描外链目录下的所有图片
		photos = scanExternalPhotos(linkSrc, folderName);

		// 查找封面图片
		const coverPhoto = photos.find(
			(p) => path.basename(p.src) === cover_name,
		);
		if (coverPhoto) {
			cover = coverPhoto.src;
		} else {
			console.warn(
				`相册 ${folderName} 在 link_src 目录下未找到封面图片: ${cover_name}`,
			);
			return null;
		}
	} else {
		// 本地模式：检查本地文件
		const coverPath = path.join(folderPath, cover_name);
		if (!fs.existsSync(coverPath)) {
			console.warn(`相册 ${folderName} 缺少 ${cover_name} 文件`);
			return null;
		}

		// 26.09.02 [7]：相册封面网页路径改读 config（dataFiles.albumsWebDir）
		cover = `${dataFiles.albumsWebDir}/${folderName}/${cover_name}`;
		photos = scanPhotos(folderPath, folderName);
	}

	// 检查是否隐藏相册
	if (info.hidden === true) {
		console.log(`相册 ${folderName} 已设置为隐藏，跳过显示`);
		return null;
	}

	// 构建相册对象
	return {
		id: folderName,
		title: info.title || folderName,
		description: info.description || "",
		cover,
		date: info.date || new Date().toISOString().split("T")[0],
		location: info.location || "",
		tags: info.tags || [],
		layout: info.layout || "grid",
		columns: info.columns || 3,
		photos,
	};
}

function scanPhotos(folderPath: string, albumId: string): Photo[] {
	const photos: Photo[] = [];
	const files = fs.readdirSync(folderPath);

	// 过滤出图片文件
	const imageFiles = files.filter((file) => {
		const ext = path.extname(file).toLowerCase();
		return [
			".jpg",
			".jpeg",
			".png",
			".gif",
			".webp",
			".svg",
			".avif",
			".bmp",
			".tiff",
			".tif",
		].includes(ext); // && file !== cover_name
	});

	// 处理每张照片
	imageFiles.forEach((file, index) => {
		const filePath = path.join(folderPath, file);
		const stats = fs.statSync(filePath);

		// 解析文件名中的标签
		const { baseName, tags } = parseFileName(file);

		// 26.09.02 [7]：照片网页路径改读 config（dataFiles.albumsWebDir）
		photos.push({
			id: `${albumId}-photo-${index}`,
			src: `${dataFiles.albumsWebDir}/${albumId}/${file}`,
			alt: baseName,
			title: baseName,
			tags: tags,
			date: stats.mtime.toISOString().split("T")[0],
		});
	});

	return photos;
}

function scanExternalPhotos(linkSrc: string, albumId: string): Photo[] {
	const photos: Photo[] = [];

	// 检查外链目录是否存在
	if (!fs.existsSync(linkSrc)) {
		console.warn(`外链目录不存在: ${linkSrc}`);
		return photos;
	}

	const files = fs.readdirSync(linkSrc);

	// 过滤出图片文件
	const imageFiles = files.filter((file) => {
		const ext = path.extname(file).toLowerCase();
		return [
			".jpg",
			".jpeg",
			".png",
			".gif",
			".webp",
			".svg",
			".avif",
			".bmp",
			".tiff",
			".tif",
		].includes(ext);
	});

	// 处理每张照片
	imageFiles.forEach((file, index) => {
		const filePath = path.join(linkSrc, file);
		const stats = fs.statSync(filePath);

		// 解析文件名中的标签
		const { baseName, tags } = parseFileName(file);

		photos.push({
			id: `${albumId}-external-photo-${index}`,
			src: `${linkSrc}/${file}`,
			alt: baseName,
			title: baseName,
			tags: tags,
			date: stats.mtime.toISOString().split("T")[0],
		});
	});

	return photos;
}

function processExternalPhotos(
	externalPhotos: any[],
	albumId: string,
): Photo[] {
	const photos: Photo[] = [];

	externalPhotos.forEach((photo, index) => {
		if (!photo.src) {
			console.warn(
				`相册 ${albumId} 的第 ${index + 1} 张照片缺少 src 字段`,
			);
			return;
		}

		photos.push({
			id: photo.id || `${albumId}-external-photo-${index}`,
			src: photo.src,
			thumbnail: photo.thumbnail,
			alt: photo.alt || photo.title || `Photo ${index + 1}`,
			title: photo.title,
			description: photo.description,
			tags: photo.tags || [],
			date: photo.date || new Date().toISOString().split("T")[0],
			location: photo.location,
			width: photo.width,
			height: photo.height,
			// camera: photo.camera,
			// lens: photo.lens,
			// settings: photo.settings,
		});
	});

	return photos;
}

function parseFileName(fileName: string): { baseName: string; tags: string[] } {
	// 匹配文件名中的标签，格式为：文件名_标签1_标签2.扩展名
	const parts = path.basename(fileName, path.extname(fileName)).split("_");

	if (parts.length > 1) {
		// 第一部分作为基本名称，其余部分作为标签
		const baseName = parts.slice(0, -2).join("_");
		const tags = parts.slice(-2);
		return { baseName, tags };
	}

	// 如果没有标签，返回不带扩展名的文件名
	const baseName = path.basename(fileName, path.extname(fileName));
	return { baseName, tags: [] };
}
