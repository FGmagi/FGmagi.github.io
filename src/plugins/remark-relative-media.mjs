import { visit } from "unist-util-visit";

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

function isRelative(url) {
	const v = url.trim();
	if (!v) return false;
	if (/^([a-z][a-z0-9+.-]*:|\/\/|\/|#|\?)/i.test(v)) return false; // 协议 / 协议相对 / 根路径 / 锚点 / 查询
	return true;
}

function rewriteTag(tag, base) {
	let out = tag;
	for (const attr of ATTRS) {
		const re = new RegExp(`(\\s${attr}\\s*=\\s*)(["'])([^"']*)(\\2)`, "gi");
		out = out.replace(re, (whole, prefix, quote, value, closing) => {
			if (!isRelative(value)) return whole;
			return `${prefix}${quote}${base}${value.replace(/^\.\//, "")}${closing}`;
		});
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
