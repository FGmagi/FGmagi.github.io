/**
 * 页面切换渐变控制器（26.09.14 重构）
 *
 * 观感目标（时长唯一来源：siteConfig.pageTransition，config.ts）：
 *   1. 切换页面时，当前整页先「渐变消失」（fadeOut）；
 *   2. 目标页此时开始加载；加载完成（content:replace，新 DOM 已替换）后进入「预渲染」静默帧
 *      ——排版、目录几何、封面盒等全部算完，期间页面保持不可见；
 *   3. 预渲染完成后，新页整体「统一渐变显示」（fadeIn，所有区域同帧起跑）；
 *   4. 目标页与当前页相同（同 URL）：同样先渐变消失，再强制重新加载该页，重新预渲染、重新渐变显示；
 *   5. 首次打开网页或刷新：必须先完成预渲染，再执行渐变显示（首帧不可见由 MainGridLayout 里
 *      body 顶部的解析期脚本 + Layout.astro <head> 的内联样式保证）。
 *   补充两条硬约束（都是实测踩过的坑，改动时别丢）：
 *   · 一次导航收尾必须释放 visit 句柄（scheduleEnterEnd → finishCurrent），否则下一次导航
 *     会被 startOut 的「已在起跑中」守卫误判成复用，整段跳过渐变、页面停在不可见；
 *   · 渐变区域里的子孙入场动画（.onload-animation）必须在预渲染帧里摘掉
 *     （clearRegionEnterAnimations），否则区域渐显结束后它们会二次淡入。
 *   顶部工具栏 #top-row 不参与渐变（任务书：仅保留上方工具栏卡片），始终可见、不播入场动画。
 *
 * ── swup 时序（v4.8.2，已核对源码，决定了本文件的钩子选择）──────────────────
 *   link:click（默认 handler）→ link:self（同 URL）
 *   performNavigation: visit:start → visit:transition
 *     → animatePageOut: animation:out:start → animation:out:await → animation:out:end
 *     → renderPage:      content:replace（默认 handler 内才真正替换 DOM）→ page:view
 *     → animatePageIn:   animation:in:await → animation:in:start → animation:in:end
 *
 *   因此：
 *   · 「渐变消失」在 visit:start / link:click 起跑；
 *   · 用 `animation:out:await`（before 钩子）把 DOM 替换**推迟到淡出真的播完**——
 *     缓存命中或极快响应时，替换与淡出就不会被压进同一帧，淡出一定看得见；
 *   · content:replace 之后页面仍处于「不可见」状态（body.swup-leaving 还在），
 *     所以替换瞬间不可能闪现旧样式；page:view 时新 DOM 与页面初始化都已完成，
 *     此时挂预渲染门、量测、再释放 → 统一渐显。
 *
 * ⚠ 时间一致性：CSS 的过渡/动画时长只读 --page-fade-out / --page-fade-in 两个 CSS 变量
 *   （由 MainGridLayout.astro 的 <style define:vars> 按同一份 config 写到 :root，
 *   本文件在 init() 里再兜一次 setProperty）。改 config 即同步生效，不要在 CSS 里写死毫秒。
 *
 * ⚠ 失败路径：swup 在 ABORTED / FAILED 时不派发任何钩子（navigate.ts:216-238），
 *   必须靠 fallbackTimer 把页面恢复可见，否则会永久停在 opacity:0。
 */

import { siteConfig } from "../config";

/* ------------------------------------------------------------------ */
/* 配置（唯一时间来源）                                                 */
/* ------------------------------------------------------------------ */

const FALLBACK_FADE_OUT = 200;
const FALLBACK_FADE_IN = 250;
const FALLBACK_PRERENDER_WAIT = 1500;

interface TransitionTiming {
	fadeOut?: number;
	fadeIn?: number;
	/** 预渲染最长等待（毫秒）：等字体就绪 + 排版稳定，超时不等 */
	prerenderMaxWait?: number;
}

/** 解析一次渐变时长：优先取 ConfigCarrier 注入到 window.siteConfig 的同源配置，回退到构建期 config */
function resolveTiming(): Required<TransitionTiming> {
	const fromWindow = (window as any)?.siteConfig?.pageTransition as
		| TransitionTiming
		| undefined;
	const fromModule = (siteConfig as { pageTransition?: TransitionTiming })
		.pageTransition;
	const value = (
		pick: (t: TransitionTiming | undefined) => number | undefined,
		fallback: number,
	) => {
		const raw = pick(fromWindow) ?? pick(fromModule);
		const num = Number(raw);
		return Number.isFinite(num) && num >= 0 ? num : fallback;
	};
	return {
		fadeOut: value((t) => t?.fadeOut, FALLBACK_FADE_OUT),
		fadeIn: value((t) => t?.fadeIn, FALLBACK_FADE_IN),
		prerenderMaxWait: value(
			(t) => t?.prerenderMaxWait,
			FALLBACK_PRERENDER_WAIT,
		),
	};
}

const timing = resolveTiming();

/** 渐变消失时长（毫秒） */
export const PAGE_FADE_OUT_MS = timing.fadeOut;
/** 渐变显示时长（毫秒） */
export const PAGE_FADE_IN_MS = timing.fadeIn;
/** 预渲染最长等待（毫秒）：等字体就绪 + 排版稳定，超时不等、照常渐显 */
export const PRERENDER_MAX_WAIT_MS = timing.prerenderMaxWait;

/**
 * 兜底写入 :root 的 CSS 变量 —— CSS（src/styles/transition.css 与 Layout.astro 的首帧内联样式）
 * 只读变量、不写死毫秒。常规路径下这组变量已由 MainGridLayout.astro 的 <style define:vars>
 * 在同一份 config 下写好（更早、且不依赖模块执行），这里再兜一次，保证任何加载顺序下都有值。
 * ⚠ 用 setProperty 而不是 define:vars：define:vars 会把变量写在 Astro 生成的选择器 scope 上，
 *   一旦该选择器本身用了 var(--x) 就会自引用解析失败。
 */
function publishTimingVariables() {
	const root = document.documentElement;
	if (!root || !root.style) return;
	root.style.setProperty("--page-fade-out", `${PAGE_FADE_OUT_MS}ms`);
	root.style.setProperty("--page-fade-in", `${PAGE_FADE_IN_MS}ms`);
}

/** 失败兜底上限：容下最慢的一次真实加载（含 head 插件最坏 3s 阻塞）与淡入余量 */
const FALLBACK_MS = Math.max(2500, PAGE_FADE_OUT_MS + PAGE_FADE_IN_MS + 2000);

/** 渐变类播完后摘类的时间余量（只在事件循环被节流时才起作用） */
const TAIL_MS = 60;

const CLASS_LEAVING = "swup-leaving";
const CLASS_ENTERING = "page-entering";
const CLASS_PRERENDER = "page-prerender";

type Phase = "idle" | "out" | "pending" | "prerender" | "in";

/** 一次淡出的句柄；awaitOut 供 swup 的 animation:out:await 等待 */
interface OutHandle {
	visit: any;
	awaitOut: Promise<void>;
	resolveOut: () => void;
	settled: boolean;
}

const state = {
	phase: "idle" as Phase,
	/** 由本控制器发起的导航（swup.navigate）：其 visit:start 不再重新起跑淡出 */
	selfInitiated: false,
	/** 同 URL 重载：等这次渐显播完后要重新加载的 URL */
	followUpUrl: "",
	/** 当前这次导航（visit:start 时登记，供 content:replace / page:view 判断归属） */
	current: null as OutHandle | null,
	/** 当前这次导航是否只是「内容未到」的占位预渲染（真内容到齐时补一次量测） */
	gateOnly: false,
	fadeTimer: null as ReturnType<typeof setTimeout> | null,
	enterTimer: null as ReturnType<typeof setTimeout> | null,
	fallbackTimer: null as ReturnType<typeof setTimeout> | null,
	/** 归一化令牌：每次新导航递增，旧回调据此退出 */
	token: 0,
	/** 一次页面加载内只注册一次 swup 钩子 */
	registered: false,
};

/* ------------------------------------------------------------------ */
/* 基础工具                                                             */
/* ------------------------------------------------------------------ */

function setPhase(phase: Phase) {
	state.phase = phase;
}

function clearTimer(name: "fadeTimer" | "enterTimer" | "fallbackTimer") {
	const timer = state[name];
	if (timer) clearTimeout(timer);
	state[name] = null;
}

function cancelFallback() {
	clearTimer("fallbackTimer");
}

function startFallback() {
	clearTimer("fallbackTimer");
	state.fallbackTimer = setTimeout(() => {
		state.fallbackTimer = null;
		// 内容始终没到 / 被中止：撤掉一切不可见状态，宁可硬切也不要永久空白
		forceEnd();
	}, FALLBACK_MS);
}

function clearVisibleClasses() {
	document.body.classList.remove(CLASS_LEAVING, CLASS_ENTERING);
}

function clearPrerenderClass() {
	document.body.classList.remove(CLASS_PRERENDER);
	(window as any).__pagePrerenderArmed = false;
}

/** 摘掉「渐变显示」类与它的收尾计时器（新导航开始时调用，避免旧动画回放） */
function clearEnter() {
	clearTimer("enterTimer");
	document.body.classList.remove(CLASS_ENTERING);
}

/** 把一切「不可见」状态撤掉，恢复页面可见（失败 / 中止 / 超时兜底） */
function forceEnd() {
	state.token += 1;
	clearTimer("fadeTimer");
	clearEnter();
	cancelFallback();
	clearVisibleClasses();
	clearPrerenderClass();
	finishCurrent();
	state.followUpUrl = "";
	state.gateOnly = false;
	setPhase("idle");
}

/** 收尾当前 visit 的句柄：让等待它的 animation:out:await 立刻放行 */
function finishCurrent() {
	const handle = state.current;
	state.current = null;
	if (handle) handle.resolveOut();
}

function makeOutHandle(visit: any): OutHandle {
	const handle: OutHandle = {
		visit,
		awaitOut: Promise.resolve(),
		resolveOut: () => {},
		settled: false,
	};
	handle.awaitOut = new Promise<void>((resolve) => {
		handle.resolveOut = () => {
			if (handle.settled) return;
			handle.settled = true;
			resolve();
		};
	});
	return handle;
}

/**
 * 预渲染帧内必须完成的量测与就位（在新 DOM 上执行）：
 *   · 摘掉区域内的入场动画类——子孙不许再各播各的，渐变只允许发生一次（见下方函数注释）；
 *   · 移动端目录面板条目同步（不参与渐变，但同样要在预渲染帧内就位）；
 *   · 目录几何重算——必须在上一步之后（几何量的是条目撑开后的高度）。
 *
 * 目录几何依赖 toc-layout.js 暴露的 window.__tocLayoutRecompute。首载时该模块与控制器
 * 同属 Layout.astro 的模块脚本，执行顺序不保证；双 rAF 通常已能覆盖，极慢环境下再各重试一次，
 * 保证「进入预渲染帧时几何已经算完」，绝不留到渐变期间才补。
 */
export function prepareRegions() {
	if (typeof window === "undefined") return;

	clearRegionEnterAnimations();

	const mobileTOCInit = (window as any).mobileTOCInit;
	if (typeof mobileTOCInit === "function") {
		try {
			mobileTOCInit();
		} catch (err) {
			/* 非文章页时内部自会清空 */
		}
	}

	const recompute = (window as any).__tocLayoutRecompute;
	if (typeof recompute === "function") {
		try {
			recompute();
		} catch (err) {
			/* 几何兜底由 CSS 变量承担 */
		}
	}
}

/**
 * 入场动画清理范围：渐变区域 + 目录 rail 外壳 + 常驻工具栏。
 *   #main-grid        主网格（左右磁贴 + 主内容 + 页脚）
 *   #toc-swup-region  目录 rail 外壳（#toc-rail-wrapper 自带 onload-animation）
 *   #banner-wrapper   顶部横幅（#main-grid 的兄弟节点）
 *   #top-row          顶部工具栏（不参与渐变、始终可见，但 #navbar 自带 onload-animation）
 */
const ANIMATION_CLEAR_ROOTS = [
	"#main-grid",
	"#toc-swup-region",
	"#banner-wrapper",
	"#top-row",
];

/**
 * 摘掉区域内的入场动画类 .onload-animation（含工具栏里的 #navbar）。
 *
 * 为什么必须做：这些子孙自带 fade-in-up 500ms + 150ms 延迟 + fill both。若留着它们，
 * 区域整体 0→1 渐变结束、状态类摘掉的那一帧动画会**重新起跑**，观感变成
 * 「整页渐显完之后卡片/目录又淡入一次、工具栏姗姗来迟」——这正是「切换不自然」的主因。
 * 首载尤其明显：首载没有 swup 换页，MainGridLayout 的 content:replace/page:view 清理不会执行。
 * 摘类后子孙停在最终可见态（opacity 自然值 1），「区域渐变」成为唯一的一次淡入。
 */
export function clearRegionEnterAnimations() {
	if (typeof document === "undefined") return;
	for (const selector of ANIMATION_CLEAR_ROOTS) {
		const root = document.querySelector(selector);
		if (!root) continue;
		if (root.classList.contains("onload-animation")) {
			root.classList.remove("onload-animation");
		}
		root.querySelectorAll(".onload-animation").forEach((element) => {
			element.classList.remove("onload-animation");
		});
	}
}

/** prepareRegions + 对目录几何入口的就绪重试（只补一次，不阻塞渐显） */
function prepareRegionsWhenReady() {
	prepareRegions();
	if (typeof (window as any).__tocLayoutRecompute === "function") return;
	window.setTimeout(() => {
		const recompute = (window as any).__tocLayoutRecompute;
		if (typeof recompute !== "function") return;
		try {
			recompute();
		} catch (err) {
			/* 同上 */
		}
	}, 0);
}

/** 预渲染：量测 + 强制排版，全程页面不可见。warm=true 表示本次是新内容到达（不是空等占位） */
function runPrerender(warm = true) {
	document.body.classList.add(CLASS_PRERENDER);
	(window as any).__pagePrerenderArmed = true;
	setPhase("prerender");
	if (warm || !state.gateOnly) {
		state.gateOnly = !warm;
		prepareRegionsWhenReady();
		// 强制样式/布局计算：把新页排版（卡片高度、目录几何、封面盒）在不可见帧内算完
		void document.body.offsetHeight;
	}
}

/**
 * 挂上「渐变显示」状态（幂等）：摘掉 status 类，只留 body.page-entering。
 *
 * ⚠⚠ 机制核心（改这里之前先读 src/styles/transition.css 文件头的「机制说明」）：
 *   渐显**不是** CSS 动画，而是 opacity 的 transition 差分：
 *     1. body.page-prerender 把区域钉在 opacity:0 且 transition:none（静默帧）；
 *     2. 本函数先摘 page-prerender、**强制一次样式重算**（flush），此时 region 的
 *        计算值仍是 0（刚脱离门控、且还没有过渡时长）；
 *     3. 紧接着摘 swup-leaving（若还在）—— 0 → 1 的过渡由此起跑，时长 = --page-fade-in。
 *   上一版用 @keyframes + page-entering 声明 opacity 的做法会失效：带动画的属性
 *   会被基线里带 !important 的 transition 抢走，且动画 fill 与基线衔接会闪。
 *   所以这里绝不能改成「只 addClass，什么都不摘」。
 */
function armEnter() {
	if (state.phase === "in") return;
	setPhase("in");
	document.body.classList.remove(CLASS_PRERENDER);
	document.body.classList.remove(CLASS_LEAVING);
	document.body.classList.add(CLASS_ENTERING);
	(window as any).__pagePrerenderArmed = false;
}

/** 摘掉渐显类并收尾（渐显时长 + 余量之后） */
function scheduleEnterEnd(next?: () => void) {
	clearTimer("enterTimer");
	state.enterTimer = setTimeout(() => {
		state.enterTimer = null;
		document.body.classList.remove(CLASS_ENTERING);
		if (state.phase !== "in") return;
		setPhase("idle");
		// 一次导航到这里才算彻底结束：放掉 visit 句柄。
		// ⚠ 漏掉这一步会让 state.current 永远非空，下一次导航就会被 startOut 的
		//   「已在起跑中」守卫误判为复用 ⇒ 不淡出、不挂门、phase 停在 idle，
		//   而 swup 侧已经换了 DOM ⇒ 新页面永远停在不可见（实测第二次导航必现）。
		finishCurrent();
		if (next) next();
		else runFollowUp();
	}, PAGE_FADE_IN_MS + TAIL_MS);
}

/**
 * 起跑「统一渐变显示」：预渲染门摘掉的那一帧，所有区域同帧起跑、同曲线同终点。
 *
 * 双 rAF 的作用是确保「预渲染帧真的被绘制过一次」再起跑（否则浏览器可能把
 * 挂类与摘类合并进同一次样式计算，过渡就不会触发）。
 * 同时准备两条保险，任何一条生效都能让页面最终可见：
 *   · enterFallbackTimer：rAF 完全不派发（后台标签页被节流）时兜底；
 *   · verifyVisible：起跑后若区域仍停在 0，用内联样式 + 注入式过渡兜底（禁用动画的环境）。
 */
function playEnter(next?: () => void) {
	state.token += 1;
	const token = state.token;
	let started = false;
	const start = () => {
		if (started || token !== state.token) return;
		started = true;
		// ⚠ 顺序不可反（这是渐显能不能看见的核心）：
		//   ① 先摘预渲染门（区域此刻仍被 swup-leaving 钉在 0，或首载时刚脱离门控）；
		//   ② 强制一次样式重算，让「不可见」这个起点真正落进计算样式快照；
		//   ③ 再由 armEnter() 摘 swup-leaving —— 0 → 1 的过渡由这一步起跑。
		//   若 ①②③ 压进同一批样式计算，起始值等于结束值 ⇒ 没有过渡 ⇒ 硬闪。
		document.body.classList.remove(CLASS_PRERENDER);
		void document.body.offsetHeight;
		armEnter();
		scheduleEnterEnd(next);
		verifyVisible();
	};

	// 兜底：内容就绪等待链可能因为 rAF 被节流而一直卡着（后台标签页）；
	// 到点无条件起跑，绝不把页面停在不可见。
	window.setTimeout(start, PRERENDER_MAX_WAIT_MS + 200);

	// 先等「内容真的渲染好了」再统一渐显：长文页的字体与排版会长时间占住主线程，
	// 不等就会出现「先出现空白卡片、文字随后才补上」。
	void (async () => {
		await waitForContentReady(token);
		// 让预渲染门的状态真正落到渲染管线（至少要跨过一帧）再起跑
		await new Promise<void>((resolve) =>
			requestAnimationFrame(() => resolve()),
		);
		start();
	})();
}

/**
 * 预渲染收尾：确认「文字已经渲染完成」再统一渐显（用户要求）。
 *
 * 实测（1.6 万 px 高的长文页，无头 Chrome 逐帧 + 帧图墨迹分析）：
 *   · 正文字体还在 loading 时字体就换字，文字会以回退字体现身、随后跳一次；
 *   · 整页排版 + 首屏绘制会长时间占住主线程（实测 ~0.8s），rAF 与 setTimeout 都被推迟，
 *     于是「门摘掉的那一帧」与「文字真正画出来」之间出现空白卡片。
 * 这里等两件事（都受 PRERENDER_MAX_WAIT_MS 约束，超时立刻放行，绝不永久停住）：
 *   ① document.fonts.ready —— 正文字体就绪；
 *   ② 文档高度连续两帧不变 —— 长文排版收敛（不会再有补排导致的位移）。
 */
async function waitForContentReady(token: number) {
	const deadline = performance.now() + PRERENDER_MAX_WAIT_MS;

	// ① 字体
	try {
		const fonts = (document as any).fonts;
		if (fonts && fonts.ready) {
			await Promise.race([
				fonts.ready,
				new Promise((resolve) =>
					window.setTimeout(
						resolve,
						Math.max(0, deadline - performance.now()),
					),
				),
			]);
		}
	} catch (err) {
		/* 字体 API 异常不应阻塞渐显 */
	}

	// ② 排版稳定（连续两次采样高度一致即可；采样之间让出一帧，方便浏览器完成排版/绘制）
	let lastHeight = -1;
	let stable = 0;
	while (token === state.token && performance.now() < deadline) {
		await new Promise<void>((resolve) =>
			requestAnimationFrame(() => resolve()),
		);
		const height = document.documentElement.scrollHeight;
		stable = height === lastHeight ? stable + 1 : 0;
		lastHeight = height;
		if (stable >= 1) break;
	}
}

/** 起跑后确认真的可见；极端环境下用内联样式兜底，绝不把页面停在不可见 */
function verifyVisible() {
	const startedAt = state.token;
	window.setTimeout(() => {
		if (startedAt !== state.token) return;
		const region = document.getElementById("main-grid");
		if (!region) return;
		const current = Number.parseFloat(
			window.getComputedStyle(region).opacity,
		);
		if (Number.isFinite(current) && current > 0.5) return;

		// 兜底：完全不做过渡地强制可见（宁可硬切，也绝不永久空白）
		const targets: Element[] = [];
		const push = (el: Element | null) => {
			if (el) targets.push(el);
		};
		push(region);
		push(document.getElementById("banner-wrapper"));
		// 目录卡片本体（毛玻璃背景画在 #toc-inner-wrapper 上，只淡内容会让背景留在原地）
		push(document.getElementById("toc-inner-wrapper"));
		region.querySelectorAll(".footer").forEach(push);

		const style = document.createElement("style");
		style.setAttribute("data-page-fade-fallback", "");
		style.textContent =
			"#main-grid,#banner-wrapper,#toc-inner-wrapper,#main-grid .footer{opacity:1 !important;transition:none !important;}";
		document.head.appendChild(style);
		targets.forEach((el) => {
			(el as HTMLElement).style.setProperty("opacity", "1", "important");
			(el as HTMLElement).style.setProperty(
				"transition",
				"none",
				"important",
			);
		});
		window.setTimeout(
			() => {
				targets.forEach((el) => {
					(el as HTMLElement).style.removeProperty("opacity");
					(el as HTMLElement).style.removeProperty("transition");
				});
				style.remove();
			},
			PAGE_FADE_IN_MS + TAIL_MS + 200,
		);
	}, PAGE_FADE_IN_MS + 200);
}

/* ------------------------------------------------------------------ */
/* out：渐变消失                                                        */
/* ------------------------------------------------------------------ */

/**
 * 同页长距离锚点跳转：整页渐变消失 → 瞬移 → 预渲染 → 统一渐显（与换页共用同一套状态类）。
 * 用于目录点标题且距离很远（config: toc.navigation.longJumpViewports）的场景——
 * 直接平滑滚过十几屏既有长时间滚动动画、又要逐屏排版绘制，观感很差。
 *
 * 复用 playEnter()：它自己带「内容就绪等待 + rAF 兜底」，不会把页面停在不可见。
 */
export function playAnchorFade(
	jump: () => void,
	opts?: { fadeOut?: number; fadeIn?: number },
) {
	if (typeof window === "undefined" || typeof document === "undefined") return;
	const outMs = Math.max(0, opts?.fadeOut ?? PAGE_FADE_OUT_MS);

	// 先把可能还在排队的渐显收尾，避免稍后又去摘一次类
	clearEnter();
	state.token += 1;
	const token = state.token;

	setPhase("out");
	document.body.classList.add(CLASS_LEAVING);
	clearTimer("fadeTimer");
	// state.fadeTimer 的静态类型是 ReturnType<typeof setTimeout>（Node 下为 Timeout），
	// 浏览器里 window.setTimeout 返回 number；与 scheduleEnterEnd 保持同一写法。
	state.fadeTimer = setTimeout(() => {
		state.fadeTimer = null;
		if (token !== state.token) return;
		// ① 瞬移（此刻整页不可见）
		jump();
		// ② 预渲染帧：量测 + 强制排版，全程保持不可见
		runPrerender(true);
		// ③ 统一渐显（含内容就绪等待与兜底）
		playEnter();
	}, outMs);
}

/** 淡出定时器到点：允许 swup 替换 DOM；若此刻内容还没到，先挂预渲染门保持不可见 */
function finishOut(handle: OutHandle, token: number) {
	if (token !== state.token || state.current !== handle) return;
	if (state.phase !== "out") return;
	// 内容是「宽限期到了但还没加载完」的占位：现在挂门（本帧就做一次基本量测），
	// 真内容到达后 page:view 会 warm=true 再量一次
	if (!document.body.classList.contains(CLASS_PRERENDER)) runPrerender(false);
	setPhase("pending");
	handle.resolveOut();
}

/**
 * 开始一次「渐变消失」。
 * 复用规则：上一次渐显（in）未播完时，先把它收尾再起跑这一次——
 * 否则会在用户还没看清当前页时就开始第二次淡出（若该导航需要等，调用方走 followUpUrl 排队）。
 *
 * ⚠ 不变量：本函数返回后，页面一定处于「不可见」。因此它必须**保留**已有的不可见
 *   状态（swup-leaving 或 page-prerender），而不是无条件清掉再重加——否则在一次
 *   导航还没走完时又发起下一次导航，会先把上一页（旧 DOM）闪回可见。
 *   注：两类的 opacity 都是 0，叠在一起不会互相干扰（leaving 的过渡只影响摘类时）。
 */
function startOut(visit?: any): OutHandle {
	if (state.phase === "in") {
		state.token += 1;
		clearEnter();
		setPhase("idle");
	}

	// 已经起跑（out/pending/prerender）：只登记 visit，不重启计时
	// ⚠ 必须连 phase 一起判：句柄只在「一次导航彻底结束」时才被释放（见 scheduleEnterEnd），
	//   所以正常收尾后 phase=idle、state.current=null；若这里只看 state.current，
	//   上一版遗留的句柄会让后续每次导航都被当成「复用」而整段跳过淡出。
	if (
		state.current &&
		(state.phase === "out" ||
			state.phase === "pending" ||
			state.phase === "prerender")
	) {
		if (visit) state.current.visit = visit;
		return state.current;
	}
	// 兜底：phase 已回到 idle 却还留着旧句柄（异常路径）时先放掉，避免上面那种误判
	if (state.current) finishCurrent();

	const handle = makeOutHandle(visit);
	state.current = handle;
	state.gateOnly = false;
	state.token += 1;
	const token = state.token;

	document.body.classList.remove(CLASS_ENTERING);
	setPhase("out");
	// 渐变消失：加类即开始（过渡时长 = --page-fade-out）
	document.body.classList.add(CLASS_LEAVING);

	startFallback();

	clearTimer("fadeTimer");
	state.fadeTimer = setTimeout(() => {
		state.fadeTimer = null;
		finishOut(handle, token);
	}, PAGE_FADE_OUT_MS);

	return handle;
}

/* ------------------------------------------------------------------ */
/* 同 URL 重载                                                          */
/* ------------------------------------------------------------------ */

/** 渐显播完后若还欠一次同 URL 重载，就在这里发起 */
function runFollowUp() {
	if (!state.followUpUrl) return;
	const url = state.followUpUrl;
	state.followUpUrl = "";
	setPhase("idle");
	startSelfReload(url);
}

/**
 * 发起一次同 URL 的真实重新加载（走 swup.navigate 而非浏览器跳转，保留 SPA 骨架）。
 * 调用前提：当前不在导航中（phase === 'idle'）。淡出已由本函数起跑，
 * 真正的 replace 会等在 animation:out:await 之后。
 */
function startSelfReload(url: string) {
	if (!url) return;
	const swup = (window as any).swup;
	if (!swup || typeof swup.navigate !== "function") {
		state.followUpUrl = "";
		return;
	}

	state.selfInitiated = true;
	startOut();
	try {
		swup.navigate(url);
	} catch (err) {
		state.selfInitiated = false;
		forceEnd();
	}
}

/* ------------------------------------------------------------------ */
/* 首载：先完成预渲染，再渐变显示                                       */
/* ------------------------------------------------------------------ */

/**
 * 首帧门由 Layout.astro 的内联脚本在**首次绘制之前**写入（给 body 加 page-prerender）。
 * 这里负责：等 DOM 就绪 → 预渲染量测 → 统一渐变显示。
 * 若没有首帧门（不是首载），直接返回。
 *
 * 用 DOMContentLoaded 而不是 load：需要等的是「DOM 与脚本就位」，
 * 不是全部图片下载完成。字体通常在 DOMContentLoaded 前已 swap 完成，
 * 未完成时也只会让首帧字形微调，不会出现空白。
 */
function maybeInitialReveal() {
	if (!(window as any).__pagePrerenderArmed) return;

	if (document.readyState === "loading") {
		document.addEventListener(
			"DOMContentLoaded",
			() => {
				runInitialReveal();
			},
			{ once: true },
		);
	} else {
		runInitialReveal();
	}
}

function runInitialReveal() {
	if (!(window as any).__pagePrerenderArmed) return;
	if (state.phase !== "idle") return;

	// 先完成预渲染（此刻页面仍然不可见），再统一渐显。
	// ⚠ 这里**不要**提前 setPhase('in')：phase 由 armEnter() 在真正起跑那一帧设置。
	//   预置会让 armEnter() 的幂等守卫直接早退 ⇒ 门永不摘除（首载永久空白）。
	//   首载动画被打断的风险由 token / phase 守卫承担（见 startOut / playEnter）。
	runPrerender(true);
	playEnter(() => {
		/* 首载没有后续导航 */
	});
}

/* ------------------------------------------------------------------ */
/* swup 钩子                                                            */
/* ------------------------------------------------------------------ */

function tryRegisterSwup(): boolean {
	if (state.registered) return true;
	if (typeof window === "undefined") return false;

	const swup = (window as any).swup;
	if (!swup || !swup.hooks || typeof swup.hooks.on !== "function")
		return false;
	if (typeof swup.navigate !== "function") return false;

	state.registered = true;
	const hooks = swup.hooks;

	// ① 「渐变消失」在点击瞬间起跑（不等目标页加载）。
	//    link:click 的 on() handler 位于默认 handler 之后，但仍在同一个 click 任务内同步执行。
	hooks.on("link:click", (visit: any) => {
		if (state.selfInitiated) return;
		if (!visit?.to) return;
		// 同页锚点（href="#id"）：swup 走 link:anchor，不产生 visit ⇒ 淡出后无人接管，交给浏览器原生滚动
		if (visit.to.hash) return;
		// 同 URL：由 link:self 分支专门处理（先消失，再强制重载）
		if (visit.from && visit.to.url === visit.from.url) return;
		startOut(visit);
	});

	// ② 同 URL 点击：swup 默认只滚到顶部（linkToSelf: 'scroll'）⇒ 不刷新内容。
	//    这里改成「先渐变消失，消失播完后强制重新加载该页」，满足「同页也要重新加载」的要求。
	//    link:self 早于 visit:start 派发，且不会派发 visit:start ⇒ 必须在这里起跑。
	hooks.on("link:self", (visit: any, args: any, defaultHandler: any) => {
		if (visit?.to?.hash) return; // 带 hash 的同页锚点不淡出
		if (typeof defaultHandler === "function") {
			try {
				defaultHandler(visit, args);
			} catch (err) {
				/* 仅用于更新历史记录 / 滚动位置，失败不影响重载 */
			}
		}

		let url = "";
		try {
			url = new URL(window.location.href).href;
		} catch (err) {
			url = window.location.href;
		}

		if (state.phase === "in") {
			// 上一次渐显还没播完：登记为后续动作，等它结束后再重新加载（避免打断）
			state.followUpUrl = url;
			return;
		}
		if (state.phase !== "idle") {
			// 已有导航在途：忽略本次点击（与 swup 对「正在导航到同一 URL」的早退行为一致）
			return;
		}

		state.followUpUrl = url;
		startOut();
		// 不同步调用 swup.navigate：那会在 swup 自己的 click 任务里重入。
		// 放进微任务即可，此时 DOM 尚未被替换，link:self 的历史/滚动语义不受影响。
		queueMicrotask(() => {
			const followUp = state.followUpUrl;
			state.followUpUrl = "";
			startSelfReload(followUp);
		});
	});

	// ③ 前进/后退：swup 默认把这次 visit 的 animate 置 false ⇒ 直接换 DOM、页面硬切。
	//    在默认 handler（performNavigation）之前打开 animate，让它走完整动画路径：
	//    animation:out:await 就会等我们的淡出播完再替换 DOM，随后照常预渲染 + 统一渐显。
	hooks.before("history:popstate", (visit: any) => {
		if (visit && visit.animation) visit.animation.animate = true;
	});

	// ④ 程序化导航（Search / PostSearchBar / MobileTOC 等 swup.navigate）不经过 link:click
	hooks.on("visit:start", (visit: any) => {
		if (state.selfInitiated) {
			// 这次导航由本控制器发起：淡出已经在跑，只登记 visit 归属
			state.selfInitiated = false;
			if (state.current) state.current.visit = visit;
			return;
		}
		// 程序化导航 / 前进后退（后者已在上面的钩子里打开 animate）都从这里起跑淡出：
		// 观感与点击链接一致——先整页渐变消失，目标页就位并预渲染后再统一渐显。
		startOut(visit);
	});

	// ⑤ 把 DOM 替换推迟到「渐变消失真的播完」：
	//    否则缓存命中 / 极快响应时，替换与淡出会压进同一帧 ⇒ 看不到淡出，观感是「硬闪」
	hooks.before("animation:out:await", (visit: any, args: any) => {
		if (args) args.skip = true;
		if (state.phase === "idle") return;
		const handle =
			state.current && state.current.visit === visit
				? state.current
				: state.current || startOut(visit);
		return handle.awaitOut;
	});

	// ⑥ 已到替换点 ⇒ 撤销失败兜底（替换本身已由上面的 await 保证发生在淡出之后）
	hooks.on("content:replace", () => {
		cancelFallback();
	});

	// ⑦ page:view：新 DOM 与页面初始化都已完成 ⇒ 预渲染量测 + 统一渐变显示
	hooks.on("page:view", () => {
		if (state.phase === "idle" || state.phase === "in") return;
		runPrerender(true);
		// 内容已经到达：撤销可能排队的同 URL 重载，避免多播一次
		state.followUpUrl = "";
		playEnter();
	});

	// ⑧ swup 自身的 in 等待会去读 [class*="transition-"] 的 transitionDuration，
	//    与本站 body 类驱动的渐变是两套时钟 ⇒ 一并跳过
	hooks.before("animation:in:await", (_visit: any, args: any) => {
		if (args) args.skip = true;
	});

	return true;
}

function registerSwup() {
	if (tryRegisterSwup()) return;
	// swup 是 loadOnIdle 惰性初始化：未就绪时等它自己的就绪事件
	document.addEventListener(
		"swup:enable",
		() => {
			tryRegisterSwup();
		},
		{ once: true },
	);
	// 保险：极慢环境下补一次轮询（swup:enable 已处理时内部直接返回）
	let tries = 0;
	const poll = setInterval(() => {
		tries += 1;
		if (tryRegisterSwup() || tries > 100) clearInterval(poll);
	}, 100);
}

/* ------------------------------------------------------------------ */
/* 入口                                                                */
/* ------------------------------------------------------------------ */

function init() {
	if (typeof window === "undefined" || typeof document === "undefined")
		return;
	if ((window as any).__pageTransitionControllerReady) return;
	(window as any).__pageTransitionControllerReady = true;

	// 时长落盘到 :root（CSS 唯一读法），并暴露给调试用
	publishTimingVariables();
	(window as any).__pageFadeOutMs = PAGE_FADE_OUT_MS;
	(window as any).__pageFadeInMs = PAGE_FADE_IN_MS;

	// 工具栏（#navbar 自带 onload-animation）与各区域子孙的入场动画在解析后就地摘掉：
	// 工具栏必须立刻可见（常驻吸顶），区域子孙则由「区域渐变」统一负责出现时机。
	clearRegionEnterAnimations();

	maybeInitialReveal();
	registerSwup();
}

init();
