import type {
	AnnouncementConfig,
	CommentConfig,
	DataFilesConfig,
	ExpressiveCodeConfig,
	FooterConfig,
	FullscreenWallpaperConfig,
	LicenseConfig,
	MusicPlayerConfig,
	NavBarConfig,
	PermalinkConfig,
	PostCardHoverConfig,
	ProfileConfig,
	SakuraConfig,
	ShareConfig,
	SidebarLayoutConfig,
	SiteConfig,
	TagFilterConfig,
} from "./types/config";
import { LinkPreset } from "./types/config";

// 注意：不要在此导入 i18n（会造成循环依赖）

// 站点语言与时区（供全站与脚本正则读取，勿改名/删除）
const SITE_LANG = "zh_CN"; // 语言代码：'en' | 'zh_CN' | 'zh_TW' | 'ja' | 'ko' | 'es' | 'th' | 'vi' | 'tr' | 'id'
const SITE_TIMEZONE = 8; // 站点时区（UTC 偏移小时，范围 -12 ~ 12，默认 UTC+8）

// 导航栏标题 Logo/图标兜底路径（相对 public/ 的网页路径，供 Navbar.astro 在配置留空时使用）
export const navbarLogoFallback = "/assets/home/default-logo.png";
export const navbarIconFallback = "/assets/home/home.png";

// ================================================================
// 数据与资源路径（dataFiles）
// 26.09.02 [7]：新增 dataFiles 配置组，统一收口散落在各页面/脚本中的数据路径。
// 语义：文件系统路径 = 相对项目根目录（供 fs 读取 / glob base / 脚本输出）；
//       网页路径 = 以 "/" 开头、相对 public/ 的 URL（供 <img>/<link> 使用）。
// ================================================================
export const dataFiles: DataFilesConfig = {
	animeJson: "public/data/anime.json", // 番剧-本地模式数据文件（文件系统路径；网页路径 /data/anime.json）
	bilibiliDataJson: "public/data/bilibili-data.json", // bilibili 番剧数据：update-bilibili 输出 + 页面主读取（网页路径 /data/bilibili-data.json）
	bilibiliDataJsonLegacy: "src/data/bilibili-data.json", // bilibili 旧数据位置（src 内兜底，仅供读取）
	bangumiDataJson: "src/data/bangumi-data.json", // bangumi 番剧数据：update-bangumi 输出 + 页面读取
	friendsJson: "public/data/friends.json", // 友链数据（网页路径 /data/friends.json）
	postsDir: "./public/data/posts", // 文章内容目录（content 集合 glob base）
	specDir: "./public/data/spec", // 独立页面内容目录（content 集合 glob base）
	albumsDir: "public/images/albums", // 相册图片目录（文件系统路径）
	albumsWebDir: "/images/albums", // 相册网页路径前缀（相对 public/）
	faviconIco: "public/favicon/favicon.ico", // 默认 favicon（OG 图片兜底；网页路径 /favicon/favicon.ico）
	fontDir: "public/assets/font", // 字体文件目录（compress-fonts.js 按此读取 TTF）
};

// 横幅图片来源：fullBanner 用于全屏壁纸，wideBanner 用于顶部横幅
const fullBanner = {
	desktop: ["/assets/images/A-FS.webp", "/assets/images/A-BA.jpg"], // 桌面横幅图片
	mobile: [
		"/assets/images/C-SK-0.webp",
		"/assets/images/C-SK-1.webp",
		"/assets/images/C-SK-2.webp",
	], // 移动横幅图片
};
const wideBanner = {
	// [死代码]：桌面横幅图源已清空（首帧闪现修复），保留结构供后续启用
	desktop: [],
	mobile: [
		"/assets/images/C-SK-0.webp",
		"/assets/images/C-SK-1.webp",
		"/assets/images/C-SK-2.webp",
	],
};

export const siteConfig: SiteConfig = {
	title: "FGmagi Blog", // 站点标题（浏览器标签、页脚等）
	subtitle: "少女祈祷中", // 站点副标题
	siteURL: "https://fgmagi.pages.dev", // 站点 URL（用于生成规范/OG 链接）
	siteStartDate: "2026-2-18", // 站点开始运行日期（YYYY-M-D），用于统计组件计算运行天数

	timeZone: SITE_TIMEZONE,

	lang: SITE_LANG,

	themeColor: {
		hue: 185, // 主题色色相（0-360）：红 0、青 200、蓝绿 250、粉 345
		fixed: false, // true=对访问者隐藏主题色选择器
	},

	// 特色页面开关（关闭后请在 navBarConfig.links 中移除对应链接）
	featurePages: {
		anime: true, // 番剧
		diary: false, // 日记
		friends: true, // 友链
		projects: false, // 项目
		skills: false, // 技能
		timeline: false, // 时间线
		albums: true, // 相册
		devices: false, // 设备
	},

	// 顶栏标题（导航栏左侧）
	navbarTitle: {
		mode: "logo", // 显示模式："text-icon" 图标+文本 | "logo" 仅 Logo
		text: "FGmagi", // 顶栏标题文本
		icon: navbarIconFallback, // 顶栏标题图标（相对 public/）
		logo: navbarLogoFallback, // 网站 Logo（相对 public/）
	},

	// 页面自动缩放
	pageScaling: {
		enable: true, // 是否开启自动缩放
		targetWidth: 2000, // 目标宽度（px），低于此宽度时开始缩放
	},

	bangumi: {
		userId: "1215825", // Bangumi 用户ID（可填 "sai" 测试）
		fetchOnDev: false, // 是否在开发环境抓取 Bangumi 数据（抓取前先执行 pnpm build 生成 json）
	},
	// 番剧进度更新命令：pnpm run update-bilibili
	bilibili: {
		vmid: "403250481", // Bilibili 用户ID（vmid）
		fetchOnDev: false, // 是否在开发环境抓取 Bilibili 数据
		SESSDATA: "", // SESSDATA（可选，用于获取观看进度，从浏览器 cookie 获取）
		coverMirror: "", // 封面镜像源（可选，如 "https://images.weserv.nl/?url="）
		useWebp: true, // 是否使用 WebP 格式封面
	},

	anime: {
		mode: "bilibili", // 番剧页数据模式："bangumi" | "local" | "bilibili"
		defaultLayout: "regular", // 追番页默认布局："regular" 常规（列表板式）| "compact" 紧凑（封面网格，每行列数按容器宽度 2~6 自动计算）
		// 番剧页空状态文案（数据缺失/为空时显示，可按需修改）
		emptyMessages: {
			noBilibiliVmid:
				"Please set your Bilibili vmid in the src/config.ts file",
			noBangumiUserId:
				"Please set your Bangumi userId in the src/config.ts file",
			bilibiliEmpty:
				"Bilibili数据为空，请运行 pnpm run update-bilibili 获取数据",
			localEmpty: "请在 src/data/anime.ts 文件中添加番剧信息",
			bangumiEmpty: "请检查 Bangumi 配置或网络连接",
		},
	},

	// 26.09.02 [12]：新增友链卡片布局组——同一行卡片数量随窗口宽度变化：breakpoints 数组按 minWidth（浏览器宽度临界值，单位 px）升序排列，
	// 达到某临界值后每行显示 columns 张卡片（friends.astro 生成 CSS 时会夹紧到 1-4，小于最小临界值的窗口以 1 列兜底）
	friendCardLayout: {
		breakpoints: [
			{ minWidth: 0, columns: 1 }, // 基础档：<640px 每行 1 张
			{ minWidth: 640, columns: 2 }, // ≥640px 每行 2 张
			{ minWidth: 1280, columns: 3 }, // ≥1280px 每行 3 张
			{ minWidth: 1600, columns: 4 }, // ≥1600px 每行 4 张
		],
	},

	// 文章列表布局
	postListLayout: {
		defaultMode: "list", // 默认布局："list" 单列 | "grid" 双列（双侧边栏 "both" 时无法使用 grid）
		// [死代码]：布局切换按钮已隐藏，保留字段不影响现有行为
		allowSwitch: true,
		pageSize: 10, // 每页文章数量（范围 5-10）
	},

	// 标签样式
	tagStyle: {
		useNewStyle: false, // true=新样式（悬停高亮），false=旧样式（外框常亮）
	},

	// 壁纸模式
	wallpaperMode: {
		defaultMode: "fullscreen", // 默认壁纸模式：banner=顶部横幅 | fullscreen=全屏壁纸 | none=无壁纸
		showModeSwitchOnMobile: "desktop", // 布局切换按钮显示设备：off | mobile | desktop | both
	},

	banner: {
		// 顶部横幅图源（数组长度 > 1 时可轮播/随机）
		src: {
			desktop: wideBanner.desktop, // 桌面横幅图片
			mobile: wideBanner.mobile, // 移动横幅图片
		},
		position: "center", // 图片位置：top | center | bottom（object-position）
		// [死代码]：轮播未启用（enable=false 时从数组中随机显示一张），保留供后续启用
		carousel: {
			enable: false, // true=轮播，false=随机显示一张
			interval: 300, // 轮播间隔（秒）
		},
		waves: {
			enable: true, // 水波纹效果（性能开销较大）
			performanceMode: false, // 性能模式：减少动画复杂度（性能提升约 40%）
			mobileDisable: false, // 移动端禁用
		},
		// PicFlow API（智能图片 API）：需 format=text 返回类型（每行一个图片链接）
		imageApi: {
			enable: false, // 启用图片 API
			url: "http://domain.com/api_v2.php?format=text&count=4", // API 地址
		},
		// 项目地址：https://github.com/matsuzaka-yuki/PicFlow-API
		homeText: {
			enable: true, // 在主页横幅显示自定义文本
			title: "", // 主标题
			subtitle: [
				"前天是小兔子，昨天是小鹿，今天是你",
				"祈祷明天对你来说，也是美好的一天",
			], // 副标题（支持数组）
			typewriter: {
				enable: true, // 副标题打字机效果
				speed: 100, // 打字速度（毫秒）
				deleteSpeed: 50, // 删除速度（毫秒）
				pauseTime: 10000, // 完整显示后的暂停时间（毫秒）
			},
		},
		credit: {
			enable: false, // 显示横幅图片来源文本
			text: "Describe", // 来源文本
			url: "", // 原图/艺术家页面 URL（可选）
		},
		navbar: {
			transparentMode: "semifull", // 导航栏透明模式：semi=半透明圆角 | full=完全透明 | semifull=动态透明
		},
	},
	toc: {
		enable: true, // 启用目录
		mode: "sidebar", // 显示模式：float=悬浮按钮 | sidebar=侧边栏
		depth: 2, // 目录深度（1-6；2=显示 h1/h2）
		useJapaneseBadge: true, // 使用日语假名序号（あいうえお...）代替数字
	},
	showCoverInContent: true, // 在文章内容页显示封面
	generateOgImages: false, // 生成 OpenGraph 图片（开启后构建很慢，不建议本地调试开启）
	favicon: [
		// 留空以使用默认 favicon（/favicon/favicon.ico）
		// { src: '/favicon/icon.png', theme: 'light', sizes: '32x32' }
	],

	// 字体配置
	font: {
		// 字体文件目录（网页路径，相对 public/；compress-fonts.js 读取同目录 TTF）
		webDir: "/assets/font",
		// @font-face 注册列表（由 Layout.astro 按此注入页面）：files 为 webDir 下文件名，按顺序降级
		faces: [
			{
				family: "思源黑体", // 字体族名（与 CSS font-family 一致）
				files: ["思源黑体.woff2", "思源黑体.ttf"], // 生产用 woff2 子集优先，dev 回退 ttf
				weight: "400",
				style: "normal",
			},
			{
				family: "萝莉体 第二版",
				files: ["萝莉体 第二版.woff2"],
				weight: "400",
				style: "normal",
			},
			{
				family: "ZenMaruGothic-Medium",
				files: ["ZenMaruGothic-Medium.woff2"],
				weight: "500",
				style: "normal",
			},
		],
		// 英文字体（优先级最高）：fontFamily=字体族名；localFonts=本地字体文件名；enableCompress=构建时生成子集 woff2
		asciiFont: {
			fontFamily: "system-ui",
			fontWeight: "400",
			localFonts: [],
			enableCompress: false,
		},
		// 中日韩字体（回退）：思源黑体启用压缩，生产构建生成 思源黑体.woff2 子集
		cjkFont: {
			fontFamily: "system-ui",
			fontWeight: "400",
			localFonts: ["思源黑体.ttf"],
			enableCompress: true,
		},
		// 全局字体栈是否包含 "Segoe UI"（true=包含，false=移除）
		useSegoeUI: true,
	},
	showLastModified: true, // 显示"上次编辑"卡片
};

export const fullscreenWallpaperConfig: FullscreenWallpaperConfig = {
	src: {
		desktop: fullBanner.desktop, // 桌面壁纸图片
		mobile: fullBanner.mobile, // 移动壁纸图片
	},
	position: "center", // 壁纸位置（object-position）
	carousel: {
		enable: true, // 启用轮播
		interval: 300, // 轮播间隔（秒）
	},
	zIndex: -1, // 层级（背景层）
	opacity: 0.28, // 壁纸透明度（0-1）
	blur: 1, // 背景模糊程度
};

// 导航栏链接（首页/全部/目录下拉）
export const navBarConfig: NavBarConfig = {
	links: [
		LinkPreset.Home,
		LinkPreset.Archive,
		{
			name: "目录",
			url: "/content/",
			icon: "material-symbols:menu",
			children: [
				{
					name: "追番",
					url: "/anime/",
					icon: "material-symbols:movie",
				},
				{
					name: "友链",
					url: "/friends/",
					icon: "material-symbols:group",
				},
				{
					name: "图片",
					url: "/albums/",
					icon: "material-symbols:photo-library",
				},
				{
					name: "我的",
					url: "/posts/myself/",
					icon: "material-symbols:person",
				},
				{
					name: "关于",
					url: "/posts/about/",
					icon: "material-symbols:info",
				},
			],
		},
	],
};

// 个人资料（侧边栏头像/简介）
export const profileConfig: ProfileConfig = {
	avatar: "/assets/images/head-image.webp", // 头像路径（以 "/" 开头相对 public/，否则相对 /src）
	name: "FGmagi",
	bio: "弱水三千，只取一瓢",
	typewriter: {
		enable: true, // 简介打字机效果
		speed: 80, // 打字速度（毫秒）
	},
	links: [],
};

export const licenseConfig: LicenseConfig = {
	enable: true, // 启用文章许可信息
	name: "CC BY-NC-SA 4.0",
	url: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
};

// Permalink 固定链接配置
export const permalinkConfig: PermalinkConfig = {
	enable: false, // 是否启用全局 permalink（关闭时使用文件名作为链接）
	/**
	 * permalink 格式模板
	 * 支持占位符：%year% %monthnum% %day% %hour% %minute% %second% %post_id% %postname% %category%
	 * 示例："%year%-%monthnum%-%postname%" => "/2024-12-my-post/"
	 * 注意：不支持 "/"，生成链接均在根目录下
	 */
	format: "%postname%", // 默认使用文件名
};

export const expressiveCodeConfig: ExpressiveCodeConfig = {
	// 注意：部分样式已被 astro.config.mjs 覆盖；请选择深色主题（当前主题仅支持深色背景）
	theme: "github-dark",
	hideDuringThemeTransition: true, // 主题切换时隐藏代码块避免卡顿
};

export const commentConfig: CommentConfig = {
	enable: false, // 启用评论功能
	twikoo: {
		envId: "https://twikoo.vercel.app",
		lang: SITE_LANG,
	},
};

export const shareConfig: ShareConfig = {
	enable: false, // 启用分享功能
};

export const announcementConfig: AnnouncementConfig = {
	title: "", // 公告标题（留空使用 i18n 默认）
	content: "施工中，暂无告示", // 公告内容
	closable: true, // [死代码]：右侧 X 关闭按钮已取消（26.09.02），字段保留兼容
	link: {
		enable: true, // 启用链接
		showLearnMore: true, // 是否显示 Learn More 链接（bool 开关：false 时不渲染 Learn More，仅保留公告内容）
		text: "Learn More", // 链接文本
		url: "/posts/about/", // 链接 URL
		external: false, // 是否外部链接
	},
};

// 26.09.02 [13]：标签筛选卡片配置——首页左下角卡片（原分类卡片空位），点击标签激活并 DOM 过滤中间文章卡片
export const tagFilterConfig: TagFilterConfig = {
	showCount: false, // 是否在标签 chip 内显示文章数（"标签名：N"）；false=仅显示标签名
};

// 首页中间内容卡片悬停变暗参数（百分比暗度；数值越大越暗）
export const postCardHoverConfig: PostCardHoverConfig = {
	startDuration: 150, // 开始悬停变暗时间
	endDuration: 150, //离开恢复时间
	hoverDarkness: 10, // 悬停时暗度 10%
	restoredDarkness: 0, // 恢复后的暗度
};

export const musicPlayerConfig: MusicPlayerConfig = {
	enable: false, // 启用音乐播放器
	mode: "meting", // 播放器模式："local" | "meting"
	meting_api:
		"https://www.bilibili.uno/api?server=:server&type=:type&id=:id&auth=:auth&r=:r", // Meting API 地址
	id: "14164869977", // 歌单 ID
	server: "netease", // 音乐源：netease=网易云、tencent=QQ、kugou=酷狗、xiami=虾米、baidu=百度
	type: "playlist", // 播单类型
};

export const footerConfig: FooterConfig = {
	enable: false, // 启用 Footer HTML 注入
	customHtml: "", // 自定义 HTML（如备案号；留空则使用 FooterConfig.html 文件内容）
};

/**
 * 侧边栏布局配置：控制组件显示、排序、动画与响应式行为
 * 注意：组件设置在 right 侧时，请确保布局为 "both" 双侧边栏；移动端通常不显示右侧栏
 * 26.09.02 [11]：全站取消分类展示——左栏移除 "categories"，空位由 13 的标签筛选卡接替；properties 中 categories 条目保留为 [死代码]
 */
export const sidebarLayoutConfig: SidebarLayoutConfig = {
	// 侧边栏组件属性配置列表
	properties: [
		{
			type: "profile", // 组件类型：用户资料
			position: "top", // 位置："top" 顶部 | "sticky" 粘性
			class: "onload-animation", // CSS 类名（样式/动画）
			animationDelay: 0, // 动画延迟（毫秒）
		},
		{
			type: "announcement", // 组件类型：公告
			position: "top",
			class: "onload-animation",
			animationDelay: 0,
		},
		{
			// [死代码]：全站已取消分类展示（26.09.02 [11]），分类卡退出侧栏，左下空位由 13 的标签筛选卡接替；条目保留供后续复用
			type: "categories", // 组件类型：分类
			position: "sticky",
			class: "onload-animation",
			animationDelay: 0,
			responsive: {
				collapseThreshold: 5, // 分类数超过该值自动折叠
			},
		},
		// 26.09.02 [13]：标签筛选卡片——接管左下角空位，点击标签 chip 激活（OR）并 DOM 过滤中间文章卡片
		{
			type: "tag-filter", // 组件类型：标签筛选
			position: "sticky",
			class: "onload-animation",
			animationDelay: 0,
			responsive: {
				collapseThreshold: 12, // 标签数超过该值自动折叠（chip 体积小，阈值取分类卡的 2~3 倍）
			},
		},
		{
			type: "tags", // 组件类型：标签
			position: "top",
			class: "onload-animation",
			animationDelay: 0,
			responsive: {
				collapseThreshold: 20, // 标签数超过该值自动折叠
			},
		},
		{
			type: "site-stats", // 组件类型：站点统计
			position: "top",
			class: "onload-animation",
			animationDelay: 0,
		},
		{
			type: "calendar", // 组件类型：日历（移动端不显示）
			position: "top",
			class: "onload-animation",
			animationDelay: 0,
		},
	],

	// 各侧栏展示的组件
	components: {
		left: ["profile", "announcement", "tag-filter"], // 左侧栏（26.09.02 [11]：已移除 categories；[13]：左下加入标签筛选卡）
		right: ["site-stats", "calendar"], // 右侧栏
		drawer: ["profile", "announcement"], // 抽屉栏
	},

	// 默认动画配置
	defaultAnimation: {
		enable: true, // 启用默认动画
		baseDelay: 0, // 基础延迟（毫秒）
		increment: 0, // 组件间递增延迟（毫秒）
	},

	// 响应式断点（px）
	responsive: {
		breakpoints: {
			mobile: 768, // 屏幕宽度 < 768px 视为移动端
			tablet: 1280, // < 1280px 视为平板
			desktop: 1280, // >= 1280px 视为桌面
		},
	},
};

export const sakuraConfig: SakuraConfig = {
	enable: false, // 启用樱花特效
	sakuraNum: 21, // 樱花数量
	limitTimes: -1, // 越界限制次数（-1=无限循环）
	size: {
		min: 0.5, // 最小尺寸倍数
		max: 1.1, // 最大尺寸倍数
	},
	opacity: {
		min: 0.3, // 最小不透明度
		max: 0.9, // 最大不透明度
	},
	speed: {
		horizontal: {
			min: -1.7, // 水平移动速度最小值
			max: -1.2, // 水平移动速度最大值
		},
		vertical: {
			min: 1.5, // 垂直移动速度最小值
			max: 2.2, // 垂直移动速度最大值
		},
		rotation: 0.03, // 旋转速度
		fadeSpeed: 0.03, // 消失速度（不应大于最小不透明度）
	},
	zIndex: 100, // 层级
};

// Pio 看板娘配置
export const pioConfig: import("./types/config").PioConfig = {
	enable: false, // 启用看板娘
	models: ["/pio/models/pio/model.json"], // 模型路径
	position: "left", // 位置
	width: 280, // 宽度
	height: 250, // 高度
	mode: "draggable", // 模式：static | fixed | draggable
	hiddenOnMobile: true, // 移动端隐藏
	dialog: {
		welcome: "Welcome to FGmagi Blog!", // 欢迎语
		touch: [
			"What are you doing?",
			"Stop touching me!",
			"HENTAI!",
			"Don't bully me like that!",
		], // 触摸提示
		home: "Click here to go back to homepage!", // 首页提示
		skin: ["Want to see my new outfit?", "The new outfit looks great~"], // 换装提示
		close: "QWQ See you next time~", // 关闭提示
		link: "https://github.com/matsuzaka-yuki/Mizuki", // 关于链接
	},
};

// 导出所有配置的统一接口（供组件按 key 引用）
export const widgetConfigs = {
	profile: profileConfig,
	announcement: announcementConfig,
	music: musicPlayerConfig,
	layout: sidebarLayoutConfig,
	sakura: sakuraConfig,
	fullscreenWallpaper: fullscreenWallpaperConfig,
	pio: pioConfig,
	share: shareConfig,
} as const;

export const umamiConfig = {
	enabled: false, // 是否显示 Umami 统计
	apiKey: import.meta.env.UMAMI_API_KEY || "api_xxxxxxxx", // API 密钥（优先从环境变量读取）
	baseUrl: "https://api.umami.is", // Umami Cloud API 地址
	scripts: `
<script defer src="XXXX.XXX" data-website-id="ABCD1234"></script>
  `.trim(), // 要插入的统计脚本（无需再去 Layout 中插入）
} as const;

