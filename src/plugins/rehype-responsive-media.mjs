import fs from "node:fs";
import path from "node:path";
import { visit } from "unist-util-visit";

let manifest;

function loadManifest() {
	if (manifest) return manifest;
	try {
		manifest = JSON.parse(
			fs.readFileSync(
				path.join(process.cwd(), "src", "generated", "media-manifest.json"),
				"utf8",
			),
		);
	} catch {
		manifest = { posts: {} };
	}
	return manifest;
}

export function rehypeResponsiveMedia() {
	return (tree) => {
		const posts = loadManifest().posts ?? {};
		visit(tree, "element", (node) => {
			if (node.tagName !== "img") return;
			const src = node.properties?.src;
			if (typeof src !== "string") return;
			const record = posts[src];
			if (!record?.medium) return;
			node.properties["data-original-src"] = src;
			node.properties["data-fancybox"] = "post-images";
			node.properties["data-src"] = src;
			node.properties["aria-label"] = "打开文章图片";
			node.properties.src = record.medium;
			node.properties.srcset = (record.webp ?? [])
				.map((variant) => `${variant.url} ${variant.width}w`)
				.join(", ");
			node.properties.sizes =
				"(max-width: 767px) calc(100vw - 3rem), min(720px, 70vw)";
			if (record.width > 0) node.properties.width = record.width;
			if (record.height > 0) node.properties.height = record.height;
			node.properties.loading = "lazy";
			node.properties.decoding = "async";
		});
	};
}

