# FGmagi Blog

个人博客，收录技术笔记、生活随笔与常用工具索引。

fgmagi.pages.dev/

## 技术栈

- Astro 5 + Svelte 5 + Tailwind CSS
- TypeScript
- pnpm

## 本地运行

```bash
pnpm install
pnpm dev
```

构建与预览：

```bash
pnpm build
pnpm preview
```

`pnpm build` 使用本地媒体、图标和字体锁文件，不主动更新远程番剧数据。需要刷新远程数据时运行
`pnpm build:online`。重构行为契约与回归矩阵位于 `docs/`。

## 部署

托管于 Cloudflare Pages，推送 `main` 分支后自动构建部署。

## 目录说明

- `public/assets`：网页媒体资源
- `public/data`：数据与文章（友链、追番、关于、我的等）
- `image`：PicGo 图床目录

