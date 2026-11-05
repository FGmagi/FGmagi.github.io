import { visit } from "unist-util-visit";
import fs from "node:fs";
import path from "node:path";

/**
 * 让 md 里**用 HTML 写的媒体**也支持相对路径（和 markdown 的 ![]() 一样）。
 *
 * 背景：文章内容目录是 public/data/posts（config: dataFiles.postsDir），public 下的文件
 * 按原路径发布。markdown 语法的图片会被 Astro 按源文件位置解析；但 <img>/<video>/<audio>
 * 这类**原始 HTML** 不走 Astro 图片管线（仓库也没开 rehype-raw），属性会被原样输出，
 * 浏览器按「页面 URL」解析相对路径 ⇒ 写 image/a.webp 基本必然 404。
 *
 * 做法：在 mdast 层遍历 html 节点，把相对路径的 src / poster 前缀补成该文章在站点里的
 * public 路径（/data/posts/<文章所在目录>/），于是：
 *   public/data/posts/foo/bar.md   里 <img src="image/a.webp"> → /data/posts/foo/image/a.webp
 *   public/data/posts/foo.md       里 <img src="image/a.webp"> → /data/posts/image/a.webp
 * 绝对路径（/…）、外链（http(s)://、//）、data:/blob:/mailto:、锚点（#）、查询串（?）保持原样。
 */

const ATTRS = ["src", "poster"];
let mediaPosts;

function loadMediaPosts() {
	if (mediaPosts) return mediaPosts;
	try {
		const manifest = JSON.parse(
			fs.readFileSync(
				path.join(process.cwd(), "src", "generated", "media-manifest.json"),
				"utf8",
			),
		);
		mediaPosts = manifest.posts ?? {};
	} catch {
		mediaPosts = {};
	}
	return mediaPosts;
}

function escapeAttribute(value) {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll('"', "&quot;")
		.replaceAll("<", "&lt;");
}

function isRelative(url) {
	const v = url.trim();
	if (!v) return false;
	if (/^([a-z][a-z0-9+.-]*:|\/\/|\/|#|\?)/i.test(v)) return false; // 协议 / 协议相对 / 根路径 / 锚点 / 查询
	return true;
}

function rewriteTag(tag, base) {
	let out = tag;
	// 全量 eager 会让文章页加载很久、首页封面也抢不到带宽。
	if (/^<img\b/i.test(out)) {
		if (!/\sloading\s*=/i.test(out)) out = out.replace(/^<img/i, '<img loading="lazy"');
		if (!/\sdecoding\s*=/i.test(out)) out = out.replace(/^<img/i, '<img decoding="async"');
	}
	if (/^<(video|audio)\b/i.test(out) && !/\spreload\s*=/i.test(out)) {
		out = out.replace(/^<(video|audio)/i, '<$1 preload="none"');
	}
	for (const attr of ATTRS) {
		const re = new RegExp(`(\\s${attr}\\s*=\\s*)(["'])([^"']*)(\\2)`, "gi");
		out = out.replace(re, (whole, prefix, quote, value, closing) => {
			if (!isRelative(value)) return whole;
			return `${prefix}${quote}${base}${value.replace(/^\.\//, "")}${closing}`;
		});
	}
	if (/^<img\b/i.test(out)) {
		const source = out.match(/\ssrc\s*=\s*(["'])([^"']+)\1/i)?.[2];
		const record = source ? loadMediaPosts()[source] : null;
		if (record?.medium) {
			const srcset = (record.webp ?? [])
				.map((variant) => `${variant.url} ${variant.width}w`)
				.join(", ");
			out = out.replace(
				/(\ssrc\s*=\s*)(["'])[^"']*\2/i,
				`$1$2${record.medium}$2`,
			);
			out = out.replace(
				/^<img/i,
				`<img data-fancybox="post-images" data-src="${escapeAttribute(source)}" aria-label="打开文章图片" data-original-src="${escapeAttribute(source)}" srcset="${escapeAttribute(srcset)}" sizes="(max-width: 767px) calc(100vw - 3rem), min(720px, 70vw)" width="${record.width || ""}" height="${record.height || ""}"`,
			);
		}
	}
	return out;
}

export function remarkRelativeMedia() {
	return (tree, file) => {
		const rawPath = String(file?.path || file?.history?.[0] || "").replace(/\\/g, "/");
		const marker = "/public/data/posts/";
		const at = rawPath.indexOf(marker);
		if (at < 0) return; // 不是文章内容（独立页面/其它目录）：不动

		const rel = rawPath.slice(at + marker.length);
		const slash = rel.lastIndexOf("/");
		const dir = slash >= 0 ? rel.slice(0, slash) : "";
		const base = `/data/posts/${dir ? `${dir}/` : ""}`;

		visit(tree, "html", (node) => {
			if (!node.value || !/<(img|video|audio|source|track)\b/i.test(node.value)) return;
			node.value = rewriteTag(node.value, base);
		});
	};
}
