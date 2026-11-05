# FGmagi Blog 行为契约

基线提交：`2ed6f1f`（2026-11-04 审计起点）

本文件冻结重构期间不得无意改变的公开行为。修改契约时必须同时更新回归矩阵和用户手册。

## 公共路由

- `/`
- `/archive/`
- `/posts/{slug}/`
- 固定链接与 alias 路由（由 `permalink` 配置生成）
- `/albums/`、`/albums/{id}/`
- `/anime/`、`/friends/`
- `/rss.xml`、`/atom.xml`、`/sitemap-index.xml`
- `/404/`

文章规范链接由 `getPostUrl()` 统一解析。旧 `/posts/{slug}/`、固定链接和 alias 均须继续可达。

## 持久化键

兼容键继续保留：

- `theme`
- `hue`
- `wallpaperMode`
- `simpleMode`
- `postListLayout`
- `animeLayoutMode`

动效与显示项的默认值统一位于 `src/config.ts` 的 `motionSettingsConfig` /
`themeColorPanelConfig`。当前主题色面板只显示色相滑条；`allowUserOverrides=false`，
因此旧 `fgmagi:settings:v2` 中的动效开关不会覆盖站点配置。

相册尺寸缓存继续使用 `mzAlbumPhoto:` 命名空间；壁纸索引继续使用现有 `mizuki_wallpaper_*` 与会话键。

## Swup 与 DOM

以下容器或稳定 ID 不得改名：

- `#main-grid`
- `#swup-container`
- `#sidebar-swup-container`
- `#toc-swup-region`
- `#navbar`
- `#banner-wrapper`
- `#toc-inner-wrapper`
- `#post-list-container`
- `#post-container`

交互状态类为：`swup-leaving`、`page-entering`、`effect1-hiding`、
`effect2-hiding`、`effect2-entering`、`effect2-revealing`、`effect2-moving`、`reduced`。
页面首载不得进入全页不可见状态；
新页替换后最多等待两个布局帧，再统一释放内容。

## 写作与图片契约

- 纸张分页注释：`<!-- model:single -->`、`<!-- model:double -->`、`<!-- model:default -->`
- 文章图片组：`data-fancybox`
- 原图与追加图片：`data-src`
- 相册图片：`data-img-row`、`data-w`、`data-span`
- 图片失败不得取消其外层链接，也不得把加载完成作为导航前置条件。

## 页面能力

- 首页：分页文章卡、封面、搜索、标签筛选。
- 归档：本地正文搜索、标签筛选。
- 文章：封面 `up` / `down` / `background`、目录、纸张分页、代码、公式、灯箱、可选加密、可选评论与分享。
- 相册：索引、瀑布流、懒加载、尺寸缓存、灯箱、返回。
- 番剧：本地 / Bilibili / Bangumi 数据，常规 / 紧凑布局。
- 友链：搜索、标签、单 / 双按钮、复制链接。
- 墙纸：完整实现支持横幅、全屏、隐藏；当前 `enableBannerMode = false` 隐藏横幅入口，
  只显示全屏与隐藏。全屏单图保留 300 秒，手动切换立即换图并重新计时。
- 布局：内容轨道默认 `90rem`；`>=1920px` 使用 `clamp(104rem, 82vw, 132rem)`，
  `>=3200px` 使用 `clamp(132rem, 64vw, 152rem)`。
- 卡片：进入时从下方上移并渐显；离开时向下方移动并渐隐。
- 动效：站点默认覆盖系统 `prefers-reduced-motion`；只有
  `respectSystemReducedMotion=true` 时才跟随系统减少动效。
- 主题色面板：除主题色滑条、色相值和复位按钮外，不再显示任何动效开关。

## 降级

- JavaScript 关闭时正文、文章链接、相册 `noscript` 图片和导航仍可读。
- 图片悬挂或 404 时容器保留尺寸，页面仍可滚动。
- Pagefind 缺失时搜索必须明确显示降级状态。
- 外部 Iconify 不可达时，构建期图标和本地图标子集仍须显示。
- 普通构建不得依赖 GitHub API 实时可用。

