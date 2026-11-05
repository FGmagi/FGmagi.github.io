import manifest from "../../generated/media-manifest.json";

type PostMediaRecord = {
	width?: number;
	height?: number;
	thumbnail?: string;
	medium?: string;
	webp?: Array<{ width: number; url: string }>;
};

export function publicPostImageUrl(src: string, basePath = ""): string {
	if (!src) return "";
	if (
		src.startsWith("/") ||
		/^https?:\/\//i.test(src) ||
		src.startsWith("data:")
	) {
		return src;
	}
	if (!basePath.startsWith("public/")) return src;
	return `/${basePath.replace(/^public\//, "").replace(/\/+$/, "")}/${src.replace(/^\.\//, "")}`;
}

export function getPostMedia(src: string, basePath = ""): PostMediaRecord | null {
	const posts = (manifest as { posts?: Record<string, PostMediaRecord> }).posts;
	return posts?.[publicPostImageUrl(src, basePath)] ?? null;
}

export function mediaSrcset(record: PostMediaRecord | null): string | undefined {
	if (!record?.webp?.length) return undefined;
	return record.webp
		.map((variant) => `${variant.url} ${variant.width}w`)
		.join(", ");
}

