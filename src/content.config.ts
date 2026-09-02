import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from 'astro/zod';
import { dataFiles } from "./config";

const postsCollection = defineCollection({
	// 26.09.02 [7]：posts 集合 glob base 改读 config（dataFiles.postsDir）；active 字段控制文章是否对外显示
	loader: glob({ pattern: "**/*.md", base: dataFiles.postsDir }),
	schema: z.object({
		title: z.string(),
		published: z.date(),
		updated: z.date().optional(),
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
