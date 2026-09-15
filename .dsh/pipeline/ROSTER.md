# 流水线花名册（Pipeline Roster）

工作区：`D:\make\Project\FGmagi.github.io`（Astro / Mizuki 主题站点）

## 常驻子 agent

| 角色 | 代号 | agent id | 职责 | 写权限 | 上下文策略 |
| --- | --- | --- | --- | --- | --- |
| 阅读分析官 | reader | `bf19e666-12c8-4b72-b177-fcb7a012502d` | 只读定位涉及文件，产出「分派单」 | **禁止写入** | 保守压缩（保留结构骨架与结论） |
| 编码执行官 | executor | `41fef86c-af3d-47a7-8f30-7791d5aa7247` | 按分派单写代码/建文件/改配置 | 允许 | 激进压缩（任务无关时） |
| 独立验收官 | codereviewer | `afab773f-16d3-4e33-a001-7a9ed2cffa20` | 独立验收需求是否完成 | 只读 + 验证命令 | 激进压缩（任务无关时） |

模型：继承当前会话模型（deepseek v4.1 flash，强度 high）。
复用方式：主控通过 `send_message` 向同一 agent id 持续分派任务，保持常驻不重建。

## 主控（main）硬性规则

1. 主控**绝不阅读任何代码文件**，只做任务拆解、分派、结果判断、向用户收口。
2. 用户提问 → 主控分析需求 → 有疑问先向用户澄清，全部明确后才启动流水线。
3. reader → executor 固定顺序；任一环节的疑问一律回报主控，由主控向用户提问。
4. **默认不启动 codereviewer**；仅当用户明确说「验证 / 检查 / 验收」时才调用。
5. 任务收尾或切换新任务时，由主控向三个 agent 统一下发压缩指令。

## 压缩协议

触发：用户确认任务结束，或开启另一个无关任务时。
指令模板：「【上下文压缩】上一个任务（<任务名>）已结束，下一个任务与本任务无关。按你的角色规则压缩上下文：保留角色契约、项目结构骨架/可用命令/已验证约定，丢弃任务细节与试错过程，回报 ≤20 行摘要。」
回报：各 agent 回一条压缩确认，主控不再追问细节。

## 标准流转

```
用户任务
  → 主控分析（有疑问→问用户）
  → reader 出分派单
      └ 有不确定 → 回报主控 → 问用户 → 接续 reader
  → executor 执行 → 交付总结
  → （仅用户明确要求）codereviewer 验收
  → 主控汇总 → 用户最终判定（通过 / 返工）
```

## 任务日志

| 序号 | 任务 | 状态 | 产物 | 备注 |
| --- | --- | --- | --- | --- |
| - | 流水线搭建 | 完成 | 本文件 + 3 个常驻 agent | 等待首个任务 |
| T1 | 文章页 TOC 修正（恢复显示 / 定位 / 末项裁切 / 修 FloatingTOC:434） | 已执行待用户本地验收 | 5 个文件改动 | 8 处改动落盘，语法门禁 failing=0、tsc src/ 错误 0。用户本地自测中 |
| T3 | 恢复全局样式入口 + TOC 同步预渲染 + 卡宽×1.1 + 居中 + 卡片取最大 + 单一高亮 | 已执行 + 已独立验收 | 6 文件改动 | 用户裁定：恢复引入 `main.css`（选项 a）｜卡宽下限 **7.92rem**｜预留 = 19.84rem｜`MIN_TOC_W` 160→96。codereviewer 判「部分通过」 |
| T3-补丁 | 同步渐变（rail 参与 swup 过渡 + 首帧前置位 + 监听守卫 + observer.disconnect） | 已执行 + 已验收 | 2 文件改动 | 30 项结构断言全绿；swup 路径静态已同步 |
| T4 | 修门槛缺口带 + 滚动抖动 + 过渡期 TOC 淡出 + anime.css 双份 | executor 执行中 | 待定 | 用户裁定全部修。**swup 条目错位已由 codereviewer 撤回，不在范围内** |

### T3 验收结论（codereviewer，含一处自我撤回）

- **阻断项（`main.css`/`variables.styl` 未接入）已真正修好**，有端到端 postcss 管线实测证据（产物 len≈166460，含 `--primary`/`--content-width`/`--toc-card-base`/`.flex{`/`.onload-animation`）。
- **几何需求通过**：最小侧距**恰 1.000rem**（1rem 兜底触发 0 次）、最小卡宽**恰 7.920rem**、0 违例。
- **需求④ 部分通过**：封顶时文章卡片与导航栏卡片**完全等宽（差 0）**；阈值 **非触摸 W≥1494 / 触摸 W≥1758**。阈值以下卡片必然更窄，属「TOC 居中 + 两侧各≥1rem」的设计代价。
- **主控第三次被纠正**：~~「文章卡片仍比导航栏窄 32px」~~ → **错**，`:926` 容器无 padding，主控重复扣了一次 padding。
- **需求③ 同步显示 = 部分通过**：swup 路径已消除；首载在 `innerWidth ≥1408` 通过，**`innerWidth` 1281–1407 存在「缺口带」**（inline 门 `matchMedia('(min-width: 88rem)')` 的 rem 恒按初始 16px = 固定 1408px，而 JS 门是 `clientWidth ≥ 88×f`，非触摸 f=13.6 ⇒ 仅需 1196.8px）。**用户窗口 1280–1536 正好覆盖此带** → T4 改动 1 修复。
- **codereviewer 撤回一条结论**：~~「swup 站内跳转后 TOC 条目错位」~~ → **误报**。`Layout.astro:1197` 的 `content:replace` 钩子每次导航后调 `init()`，而 `tocHtmlMatchesDocument` 恒判不一致 ⇒ 每次按新页面重建条目并重映射 sections。**该缺陷不存在。**
- 其余登记项：`tocHtmlMatchesDocument` 恒判不一致（方向安全、优化失效）；SSR 与客户端数据源不同源；`retryRegenerate` 异步分支边界；`page-entering` 360ms 与 rail 250ms 的隐式耦合；`wideEnough` 按旧 88rem 保守约 8rem；`@import "./variables.styl"` 依赖 Vite 的 preprocessor-aware postcss-import（脱离 Vite 会抛 `Unknown word key`）。

### T3/T4 关键机制（复用）

- **swup 过渡**：`.page-transition-region` = `#main-grid`；`body.swup-leaving` / `body.page-entering` 驱动；`#toc-rail-wrapper` 在 `</main>` 之外，必须**单独镜像同参规则**才能同步。
- **首载同步**：rail 初始 `hidden`，`display:block` 依赖 `data-toc-layout`；用解析期 `is:inline` 脚本预置位才能与卡片同帧起跑。**门槛必须与 `toc-layout.js` 同源**，否则产生缺口带。
- **动画参数**（两侧必须逐字一致）：首载 `.onload-animation` = `fade-in-up 500ms ease-out 150ms both`（`transition.css:86-90`）；swup 离开 = `opacity 0.2s cubic-bezier(0.4,0,0.2,1)`；swup 进入 = `page-region-fade-in 0.25s cubic-bezier(0.4,0,0.2,1) both`。
- **门禁清单（本轮扩充）**：全量 `.astro` 解析（@astrojs/compiler）｜TS-parser 扫 frontmatter+script（**108 块，权威口径；esbuild 对 ESM 顶层 `return Astro.redirect()` 有 10 处假阳性**）｜`tsc --noEmit` 差分（只看 `src/`=0）｜**stylus 编译**｜**postcss 全链复刻**（Vite 的 postcss-import+stylus load → 用户 postcss-import → nesting → tailwindcss）。

### T3 需求（用户原话）

> 「存在问题，toc没有和文章卡片一同进入预渲染，而是在文章卡片显示后才渐变显示。二者改为同步显示。目前排版显然存在问题，toc过窄，明明文章卡片不需要压缩宽度的情况下，压缩了宽度。请重新仔细阅读我的需求，放弃不合理的间隔布局，在自适应的情况下，重新完成以下任务：1.在任何界面，下拉时保持导航栏常驻在最上方。不考虑横幅模式，因为横幅模式已经被放弃了。2.导航栏的根据当前阅读位置，将正在阅读部分高亮标记，但仅标记当前页面显示的最上方的内容对应的标题，不需要标记多个标题的情况。3.当前导航栏与左边文章卡片、右边视窗右边距距离过大。将toc宽度，增加到当前的1.1倍，toc与左右间距硬性要求为1rem以上，大于的情况下居中显示。4.文章卡片现在明明可以取到最大值，和导航栏宽度相同，但没有，修正。5.以上要求，修复后自行验证。」

用户澄清：需求② 的「导航栏」= **右侧栏目录卡（`widget/TOC.astro`）**，即把「用主题色高亮正在阅读内容」由多处高亮改为**只高亮最上方那一个标题**。

### T3 关键机制（reader 分析）

- **不同步的完整时序**：`#toc-rail-wrapper` 初始 `hidden` 由 JS 置 desktop 才显示 → `<table-of-contents>` SSR 为空、条目由 JS 生成 → 玻璃卡外观挂在 `:has(table-of-contents[data-loaded="true"])` 而 `data-loaded` 在 `regenerateTOC()` 末尾才置位 → 页面切换时 `#toc-container` 带 `transition-swup-fade` 以 300ms 独立淡出（主网格 200/250ms）。
- **多处高亮根因**：`TOC.astro:158-172` 的 `fallback` 把所有与视口相交的 section 都标 active；`:83-119` 的 `toggleActiveHeading` 再把 min..max 连续区间全部加 `visible` 类。
- **导航栏常驻已满足**：`#top-row` 是 body 直接子元素 + `sticky top-0 z-50`，祖链无 transform/filter/contain/overflow（T3 步骤 5 不改代码，仅确认）。

### T1+T2 独立验收结论（codereviewer，2026-xx）

- **结论：部分通过 → 已无未决项**。8 条需求静态实现全部成立；62 个 .astro `errors=0`；TS-parser 扫 108 个 script 体 `failing=0`（基线 1）；tsc `src/=0`（总数 43 与基线一致）；**stylus exit=0**，嵌套 `min/max/calc` 未被改写、无 unquote 残留；无循环引用、无第二套定位规则并存。
- **1rem 底线永不触发**：全扫描 1024–4000，触发 0 次；桌面最小空隙恒为 **2.9rem**。
- **数值口径（以 codereviewer 复算为准）**：非触摸桌面根字号 `f=clamp(W/2000,0.85,1)×16`。W=1408→f13.6/C1054.4/距右39.4；1536→f13.6/C1182.4/距右39.4；1856→f14.848/C1336.3/距右56.4；1920→f15.36/C1382.4/距右58.4；2560→f16/C1440/距右116.8。**主控早期给的 B 表有 3 处错误，已废弃**。
- **脆耦合（登记）**：`--toc-width` 最小 163.2px 对 `MIN_TOC_W=160` 仅余 3.2px；若把 `config.toc.sidebarRailWidth` 调到约 12.76rem 以下，桌面目录会**静默退化**为移动端入口。
- **无法在本沙箱判定**（无浏览器 + astro build EPERM）：TOC 是否真显示、视觉居中、末项半截裁切观感、内部滚动、swup 切换后重算、亮暗/壁纸毛玻璃表现、stylus 之后的 postcss 阶段。

### 用户确认为「既有有意改动」、不属 T1/T2 范围（勿判为缺陷）

1. `Layout.astro` 删除 `navbar-hidden` 滚动隐藏 + `MainGridLayout.astro:722-728` `#top-row` 改 sticky / `#navbar-wrapper` 改 relative → **全站导航栏永不再隐藏**（用户确认为有意）。
2. `BackToTop.astro` `bottom: 10rem → 5rem`（回顶按钮全站下移 5rem）。
3. `MobileTOC.svelte:319-326` 移动端目录入口由注释态启用 → **<1280px 全站**出现目录入口（用户确认接受）。
4. `MainGridLayout.astro:981-983` 附带注释改写（为已删除的 `#toc-wrapper` 规则消除错误指引，主控认可）。

## ⚠️ 已作废的主控错误结论（勿再引用）

以下均为**主控**早期纸面验算的错误结论，已由 reader / codereviewer 独立复核推翻：

1. ~~「改单侧预留能让文章卡片宽 168–380px」~~ → 错，单侧 vs 对称只差 32px；真正的差距来自预留量取值过大。
2. ~~「TOC 卡右边缘 = 视口右 − edgeGap 是数学下限」~~ → 机理错，居中后是涌现值。
3. ~~「导航栏与文章卡片恒差 32px」~~ → 错，两边 padding 对称，`C = P` 时严格相等。
4. ~~「卡片取最大与 TOC 加宽互斥，必须定优先级」~~ → **错**（用户当场指出）：卡宽锚定成固定基准后是常量，不吃空间，剩余归文章卡片；两者可同时满足。
5. ~~「1440 视口文章 = 736」~~ → 错，实为 1086.4。
6. ~~T2 期望数值矩阵中 1408 / 1856 / 1920 三处~~ → 漏算 `pageScaling` 根字号（`f = clamp(W/2000, 0.85, 1) × 16`），已作废。

## 🔴 阻断性发现（T3 时由 reader 发现、主控独立核实）

**`src/styles/main.css` 与 `src/styles/variables.styl` 在当前源码中没有任何文件 import。**
全仓 import 仅覆盖 8 个 css（`Layout.astro:26-30` 五个、`pages/anime.astro:9`、`components/Encryptor.astro:4-7` 三个）；两文件全仓仅剩注释提及（`toc-layout.js:10`、`Layout.astro:390`）。9/6 的 dist 产物里含其编译结果（`@tailwind base` preflight、`--primary: oklch(...)`）⇒ 入口是后来丢失的。

**后果**：`--toc-card-width` / `--content-width` / `--primary` 全部不存在 ⇒ `w-[var(--toc-card-width)]` 退化为 `width:auto`（TOC 缩成内容宽）、`max-w-[var(--content-width)]` 退化为 `max-width:none`（文章容器撑满）。**这是用户报告的「TOC 过窄 + 间距异常」的直接根因，也意味着 T1/T2 对 `variables.styl` 的全部改动从未在页面上生效。**
**处理**：T3 步骤 0 恢复引入（用户裁定选项 a：`Layout.astro` 新增 `import "../styles/main.css";`）。整站外观会显著变化（主题色/Tailwind/组件类回归），需分阶段验收。

### T2 已锁定的需求（用户两轮原话）

> 「含 TOC 整体 ≤ 主页宽度是错误决定，应该为文章卡片 ≤ 主页宽度，toc 始终位于文章卡片右侧。文章卡片宽度在不与 toc 重叠情况下，最大取与导航栏宽度相同。若无法取到该最大值，缩小文章卡片宽度，但导航栏宽度不变。以下代码回卷：取消缩小到 90% 宽度的指令」

> 「为 toc 取视口右边与文章卡片右边距之间的居中位置。toc 与视口右边距不小于 1rem，当小于 1rem 时，开始尝试减少文章卡片宽度。」

**主控验算结论（待 reader 复核）**：模型 1 下「1rem 触发缩卡片」在任何桌面视口都不会被触发（最紧时约剩 30px），只作兜底；TOC 卡右边缘 = 视口右 − edgeGap 是数学下限，故 1rem 底线天然成立。关键实现障碍 = 现有 `--article-width` 为**左右对称预留**（左侧多留一条 448px 目录轨道），必须改为**单侧预留**，否则 1536 视口下文章卡片比可达最大值窄 168px、1440 视口下窄 380px。

### T1 已定位根因（reader 只读分析，供后续复用）

- **TOC「不显示」**：`MainGridLayout.astro:1144` 的 `right` 表达式符号写反 → 目录被压进文章卡片区域，且文章卡片 `z-30` 盖住目录 `z-0`。
- **末项溢出卡片**：26.09.06 删除了卡片的 `overflow-hidden`，改用「两处 max-height 相等」的约定，该约定在 `--toc-max-h` 未写入时不成立。
- **构建阻断**：`FloatingTOC.astro:434` 悬空 `];*/`，全仓唯一语法坏点。
- **导航栏被压缩**：desktop 下 `--content-width = --article-width`，而 `--article-width` 预留了 `2*(13rem+1rem)=448px` 的目录轨道，导航栏随之变窄。
