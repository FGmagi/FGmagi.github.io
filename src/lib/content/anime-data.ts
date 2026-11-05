import fs from "node:fs";
import path from "node:path";
import { dataFiles, siteConfig } from "../../config";

export interface AnimeItem {
	title: string;
	cover: string;
	link: string;
	status: string;
	rating: number;
	progress: number;
	totalEpisodes: number;
	description: string;
	year: string;
	studio: string;
	genre: string[];
}

const FALLBACK_COVER =
	"data:image/svg+xml;charset=utf-8," +
	encodeURIComponent(
		'<svg xmlns="http://www.w3.org/2000/svg" width="220" height="300"><rect width="100%" height="100%" fill="#e5e7eb"/><text x="50%" y="50%" fill="#9ca3af" font-size="18" text-anchor="middle" dominant-baseline="middle">No Cover</text></svg>',
	);

export function mapAnimeItems(rawData: unknown[]): AnimeItem[] {
	return rawData.map((raw): AnimeItem => {
		const item = raw as Record<string, any>;
		return {
			title: item.title || "Unknown",
			cover: item.cover || FALLBACK_COVER,
			link: item.link || "#",
			status: item.status || "planned",
			rating: Number(item.rating) || 0,
			progress: Number(item.progress) || 0,
			totalEpisodes: Number(item.totalEpisodes) || 12,
			description: item.description || "",
			year: item.year || "",
			studio: item.studio || "",
			genre: Array.isArray(item.genre) ? item.genre : [],
		};
	});
}

function readArray(file: string): unknown[] {
	if (!fs.existsSync(file)) return [];
	try {
		const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

function firstNonEmpty(files: string[]): AnimeItem[] {
	for (const file of files) {
		const rows = readArray(path.join(process.cwd(), file));
		if (rows.length > 0) return mapAnimeItems(rows);
	}
	return [];
}

export function loadAnimeData(mode: string, isDev: boolean): AnimeItem[] {
	if (mode === "local") {
		return firstNonEmpty([dataFiles.animeJson]);
	}
	if (mode === "bilibili") {
		if (isDev && !(siteConfig.bilibili?.fetchOnDev ?? false)) {
			return firstNonEmpty([
				dataFiles.bilibiliDataJson,
				dataFiles.animeJson,
			]);
		}
		return firstNonEmpty([
			dataFiles.bilibiliDataJson,
			dataFiles.bilibiliDataJsonLegacy,
			dataFiles.animeJson,
		]);
	}
	if (isDev && !(siteConfig.bangumi?.fetchOnDev ?? false)) return [];
	return firstNonEmpty([dataFiles.bangumiDataJson]);
}

