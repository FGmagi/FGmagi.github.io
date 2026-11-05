import type { CollectionEntry } from "astro:content";
import { formatDateToYYYYMMDD } from "../../utils/date-utils";
import { getPostUrl } from "../../utils/url-utils";

export function createPostViewModel(
	entry: CollectionEntry<"posts">,
	options: { site: URL | undefined; siteName: string; lang: string },
) {
	const canonicalUrl = new URL(getPostUrl(entry), options.site).toString();
	const imageMode = entry.data.image_mode || "up";
	const isEncrypted = Boolean(entry.data.encrypted && entry.data.password);
	const hasCover = Boolean(entry.data.image);
	const tags = entry.data.tags.map((tag) => ({
		name: tag.trim(),
		searchUrl: `/archive/?q=${encodeURIComponent(tag.trim())}`,
	}));
	const jsonLd = {
		"@context": "https://schema.org",
		"@type": "BlogPosting",
		headline: entry.data.title,
		description: entry.data.description || entry.data.title,
		keywords: entry.data.tags,
		author: {
			"@type": "Person",
			name: entry.data.author || options.siteName,
			url: options.site?.toString(),
		},
		datePublished: formatDateToYYYYMMDD(entry.data.published),
		dateModified: formatDateToYYYYMMDD(
			entry.data.updated || entry.data.published,
		),
		inLanguage: (entry.data.lang || options.lang).replace("_", "-"),
		url: canonicalUrl,
		mainEntityOfPage: canonicalUrl,
	};
	return {
		canonicalUrl,
		imageMode,
		isEncrypted,
		hasCover,
		tags,
		jsonLd,
	};
}

export type PostViewModel = ReturnType<typeof createPostViewModel>;

