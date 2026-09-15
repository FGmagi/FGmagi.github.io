import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from 'astro/zod';
import { dataFiles } from "./config";

/**
 * 26.09.15：日期宽松解析。
 * md 里允许写 2026-1-5 / 2026-1-05 / 2026.1.05 / 2026\1\5 / 2026年1月5日（可带 12:30[:45]），
 * 统一解析成 Date（按**本地时区**，与归档按年份分组、展示格式化同口径）；
 * 解析不了时给出明确告警并回退 1970-01-01（排序最旧），避免 md 日期笔误导致整站构建失败。
 */
function parseLooseDate(input: unknown): Date {
	if (input instanceof Date && !Number.isNaN(input.getTime())) return input;
	if (typeof input === "number" && Number.isFinite(input)) return new Date(input);
	const raw = String(input ?? "").trim();
	if (raw) {
		const m = raw.match(
			/^(\d{4})\s*[-./\\年]\s*(\d{1,2})\s*[-./\\月]\s*(\d{1,2})\s*日?(?:[T\s]+(\d{1,2})\s*[:：]\s*(\d{1,2})(?:\s*[:：]\s*(\d{1,2}))?)?/,
		);
		if (m) {
			const d = new Date(
				Number(m[1]),
				Number(m[2]) - 1,
				Number(m[3]),
				Number(m[4] ?? 0),
				Number(m[5] ?? 0),
				Number(m[6] ?? 0),
			);
			if (!Number.isNaN(d.getTime())) return d;
		}
		const fallback = new Date(raw);
		if (!Number.isNaN(fallback.getTime())) return fallback;
	}
	console.warn(
		`[content] 无法识别的日期：${JSON.stringify(input)}（支持 2026-1-5 / 2026.1.05 / 2026\\1\\5 / 2026年1月5日 等，已回退 1970-01-01）`,
	);
	return new Date(0);
}

/** published / updated 通用：宽松解析 + 规范成 Date；留空仍是 undefined（供 optional 用） */
const looseDate = z.preprocess(
	(v) => (v === undefined || v === null || v === "" ? undefined : parseLooseDate(v)),
	z.date().optional(),
);

const postsCollection = defineCollection({
	// 26.09.02 [7]：posts 集合 glob base 改读 config（dataFiles.postsDir）；active 字段控制文章是否对外显示
	loader: glob({ pattern: "**/*.md", base: dataFiles.postsDir }),
	schema: z.object({
		title: z.string(),
		published: z.preprocess((v) => parseLooseDate(v), z.date()),
		updated: looseDate,
		draft: z.boolean().optional().default(false),
		description: z.string().optional().default(""),
		image: z.string().optional().default(""),
		tags: z.array(z.string()).optional().default([]),
		category: z.string().optional().nullable().default(""),
		lang: z.string().optional().default(""),
		pinned: z.boolean().optional().default(false),
		active: z.boolean().optional().default(true),
		priority: z.number().optional(),
		author: z.string().optional().default(""),
		sourceLink: z.string().optional().default(""),
		licenseName: z.string().optional().default(""),
		licenseUrl: z.string().optional().default(""),

		/* Page encryption fields */
		encrypted: z.boolean().optional().default(false),
		password: z.string().optional().default(""),

		/* Posts alias */
		alias: z.string().optional(),

		/* 文章封面渲染模式：up=标题上方，down=标题下方正文前，background=封面作为页面背景 */
		image_mode: z.enum(["up", "down", "background"]).optional().default("up"),

		/* Custom permalink - 自定义固定链接，优先级高于 alias */
		permalink: z.string().optional(),

		/* For internal use */
		prevTitle: z.string().default(""),
		prevSlug: z.string().default(""),
		nextTitle: z.string().default(""),
		nextSlug: z.string().default(""),
	}),
});
const specCollection = defineCollection({
	// 26.09.02 [7]：spec 集合 glob base 改读 config（dataFiles.specDir）
	loader: glob({ pattern: "**/*.md", base: dataFiles.specDir }),
	schema: z.object({}),
});
export const collections = {
	posts: postsCollection,
	spec: specCollection,
};
