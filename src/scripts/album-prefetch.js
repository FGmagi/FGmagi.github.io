/**
 * 相册图片尺寸「空闲预计算」（B 任务）：在非相册页空闲时提前计算所有相册图片的尺寸。
 *
 * 硬性约束：
 *  - 严禁提前加载图片内容 —— 只走 manifest + Range 头字节探测（photo-size），绝不全量下载；
 *  - 渐进分批、可中止 —— requestIdleCallback（降级 setTimeout）+ AbortController：
 *    离开/隐藏/切页中止；当前关注相册优先（即不抢占相册页自身渲染，探测并发压低）；
 *  - 26.09.14：探测整体下沉 Web Worker（photo-probe-client），主线程只收结果写缓存；
 *    单轮有全局截止（PREFETCH_DEADLINE_MS），外链大面积不可达时不会一直空转；
 *  - 尺寸一律入 localStorage（photo-cache，mzAlbumPhoto: 命名空间），与 A 共用同一套尺寸
 *    获取 + 缓存；运行期绝不回写构建产物。
 *
 * 注册时机：模块顶层只注册一次；但「只在用户首次进入相册相关页后」才真正开始预计算
 * （sessionStorage 记录），避免从未关心相册的访客产生无谓的 Range 请求。
 * manifest 获取带 404 / 结构守卫（predev 不产出文件时静默跳过）。
 */

import { getSize, setSize, prune, sweepByKeys } from "../utils/photo-cache.js";
import { probePhotoSizes } from "../utils/photo-probe-client.js";

const MANIFEST_URL = "/data/photo-meta.json";
const PROBE_CONCURRENCY = 3; // 预计算把带宽让给用户浏览，并发压得比相册页低
const PROBE_TIMEOUT_MS = 8000; // 单次 Range 探测超时
const PREFETCH_DEADLINE_MS = 10000; // 单轮全局截止：到点收工，剩余项留待下一轮（若被允许）
const IDLE_TIMEOUT_MS = 4000; // requestIdleCallback timeout 兜底
const RETRY_COOLDOWN_MS = 60 * 1000; // 中断后再次尝试的最小间隔

const SEEN_KEY = "mzAlbumPrefetch:seenAlbum"; // sessionStorage
const DONE_KEY = "mzAlbumPrefetch:roundDone"; // sessionStorage：每个会话只完整跑一轮

let seenAlbum = false;
let roundDone = false;
let running = false;
let lastAttempt = 0;
let armedForPageView = false;
let currentAbort = null;
// 26.09.14：诊断通道状态。模块级声明（runRound 需要读它），install() 时按 ?prefetch=debug 置位
let DEBUG = false;

function ssGet(key) {
	try {
		return sessionStorage.getItem(key);
	} catch {
		return null;
	}
}
function ssSet(key, value) {
	try {
		sessionStorage.setItem(key, value);
	} catch {
		/* ignore */
	}
}

function currentPath() {
	return typeof window !== "undefined"
		? window.location.pathname || "/"
		: "/";
}

function isAlbumRelated(path) {
	return path === "/albums" || path.startsWith("/albums/");
}

function abortCurrent() {
	if (currentAbort) {
		currentAbort.abort();
		currentAbort = null;
	}
}

async function probeDims(tasks, signal) {
	// 26.09.14：整批交 Worker（并发 3、全局截止 10s），主线程只负责写缓存
	await probePhotoSizes(tasks, {
		signal,
		concurrency: PROBE_CONCURRENCY,
		timeoutMs: PROBE_TIMEOUT_MS,
		deadlineMs: PREFETCH_DEADLINE_MS,
		onResult: (key, w, h) => setSize(key, w, h, { verify: true }),
	});
}

async function runRound(signal) {
	// 顺带做一次缓存维护（内部自带节流：>800 条 / >90 天 / 损坏键）
	try {
		prune();
		sweepByKeys();
	} catch {
		/* 缓存维护失败不阻塞主流程 */
	}

	let res;
	try {
		res = await fetch(MANIFEST_URL, { signal });
	} catch {
		return; // 网络错误 / 中止：静默
	}
	// 404 守卫（predev 无 manifest 时静默跳过）
	if (!res || !res.ok) return;

	let data = null;
	try {
		data = await res.json();
	} catch {
		return;
	}
	if (!data || data.schema !== 2 || !Array.isArray(data.albums)) return;

	// 26.09.14：候选过滤改为「校验式」——
	// 本仓库 74/74 张外链图的尺寸在构建期就被 sharp 从本地原档解析出来了（manifest 里全都带 w/h），
	// 旧的「构建期已知就跳过」会让候选恒为 0，预取等于永不工作。现在改为：
	//   a) 构建期声明式已知（photo.known !== true）→ 无需运行期校验，跳过；
	//   b) 构建期探测所得（photo.known === true）→ 只有本版本已校验过（verifiedOnly 命中）才跳过；
	//   c) 构建期未知 → 任意缓存（探测所得或其它来源）都算数；
	//   d) 非 http(s) 外链不探测。
	const tasks = [];
	for (const album of data.albums) {
		if (!album || !album.id) continue;
		if (!Array.isArray(album.photos)) continue;
		for (const photo of album.photos) {
			if (!photo || !photo.key || !photo.src) continue;
			const buildKnown = photo.w > 0 && photo.h > 0;
			if (buildKnown && photo.known !== true) continue; // a) 声明式已知
			if (buildKnown && getSize(photo.key, { verifiedOnly: true }))
				continue; // b) 本版本已校验
			if (!buildKnown && getSize(photo.key)) continue; // c) 未知项：任意缓存都算
			if (!/^https?:\/\//i.test(photo.src)) continue; // d) 非外链
			tasks.push({ key: photo.key, src: photo.src });
		}
	}

	// 26.09.14：空候选必须可见 —— 否则「无日志」会被当成功能失效
	if (tasks.length === 0) {
		console.warn(
			`[album-prefetch] 本轮无候选（manifest ${data.albums.length} 个相册）：所有外链图尺寸均已在构建期解析并已校验，跳过预取。`,
		);
	} else if (DEBUG) {
		console.log(
			`[album-prefetch] 候选 ${tasks.length} 张：并发 ${PROBE_CONCURRENCY}，单项超时 ${PROBE_TIMEOUT_MS}ms，单轮截止 ${PREFETCH_DEADLINE_MS}ms`,
		);
	}

	// 26.09.14：整批交 Worker 渐进探测（内部分批 + 全局截止 + 可中止），绝不全量下载
	if (tasks.length > 0) await probeDims(tasks, signal);
	if (signal.aborted) return;
	// 只有整批都「已校验」（或本轮无候选）才算跑完；被截止/失败截断的留待下一轮（受冷却间隔约束）
	const remaining = tasks.filter(
		(task) => !getSize(task.key, { verifiedOnly: true }),
	).length;
	if (remaining > 0) {
		// 26.09.14：不收敛也要可见（静默 return 会让问题无法诊断）
		console.warn(
			`[album-prefetch] 未收敛 ${remaining}/${tasks.length} 张（外链不可达或被单轮截止截断），${Math.round(RETRY_COOLDOWN_MS / 1000)}s 冷却后可再试。`,
		);
		return;
	}
	roundDone = true;
	ssSet(DONE_KEY, "1");
}

function scheduleRoundIfDue() {
	if (typeof document === "undefined") return;
	if (roundDone || running) return;
	if (!seenAlbum) return;
	const now = Date.now();
	if (now - lastAttempt < RETRY_COOLDOWN_MS) return;
	lastAttempt = now;

	const ctrl = new AbortController();
	currentAbort = ctrl;
	running = true;

	const task = () => {
		// 空闲任务开始时若页面已隐藏/离开，作废（避免无谓请求）
		if (document.hidden || ctrl.signal.aborted) {
			running = false;
			return;
		}
		void runRound(ctrl.signal).finally(() => {
			if (currentAbort === ctrl) currentAbort = null;
			running = false;
		});
	};
	if (typeof requestIdleCallback === "function") {
		requestIdleCallback(task, { timeout: IDLE_TIMEOUT_MS });
	} else {
		setTimeout(task, Math.min(IDLE_TIMEOUT_MS, 1500));
	}
}

function onPageView() {
	if (!armedForPageView) return;
	armedForPageView = false;

	// 切页：中止在途预计算（设计约束：切页中止）
	abortCurrent();

	const path = currentPath();
	if (isAlbumRelated(path)) {
		// 相册页：相册自身的渲染编排优先，不做空闲预计算
		return;
	}
	// 非相册页：用户若访问过相册相关页，则空闲时开始预计算
	scheduleRoundIfDue();
}

function onContentReplace() {
	armedForPageView = true;
}

function install() {
	if (typeof window === "undefined" || typeof document === "undefined")
		return;

	// 26.09.14：诊断通道 —— 仅 ?prefetch=debug 时输出详细日志
	DEBUG =
		typeof location !== "undefined" &&
		new URLSearchParams(location.search).get("prefetch") === "debug";

	// 恢复会话状态
	seenAlbum = ssGet(SEEN_KEY) === "1";
	roundDone = ssGet(DONE_KEY) === "1";

	// 记录相册相关页访问
	const markSeenIfAlbum = () => {
		if (!seenAlbum && isAlbumRelated(currentPath())) {
			seenAlbum = true;
			ssSet(SEEN_KEY, "1");
		}
	};

	// swup 生命周期：content:replace →（首个）page:view
	const swup = window.swup;
	if (swup && swup.hooks && typeof swup.hooks.on === "function") {
		swup.hooks.on("content:replace", onContentReplace);
	} else {
		document.addEventListener("swup:enable", () => {
			const s = window.swup;
			if (s && s.hooks && typeof s.hooks.on === "function") {
				s.hooks.on("content:replace", onContentReplace);
			}
		});
	}
	// @swup/astro 与 swup 内核在 page:view 各派发一个信号，armed 只消费首个
	document.addEventListener("astro:page-load", onPageView);
	document.addEventListener("swup:page:view", onPageView);

	// 整页离开中止
	window.addEventListener("pagehide", abortCurrent);

	// 首载（26.09.14 注：触发条件由 scheduleRoundIfDue 内部把关，本处逻辑无需改动）
	// 非相册页首载 → scheduleRoundIfDue()；但它会被 `if (!seenAlbum) return;` 挡住 —— 这是设计：
	// 只有「本会话先访问过 /albums 或 /albums/*」的访客才会预取，从未关心相册的访客不产生任何 Range 请求。
	// 也就是说：fresh session 直接开在文章页不会预取；先看过相册页、再回到非相册页（或刷新）才会预取。
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", () => {
			markSeenIfAlbum();
			if (!isAlbumRelated(currentPath())) scheduleRoundIfDue();
		});
	} else {
		markSeenIfAlbum();
		if (!isAlbumRelated(currentPath())) scheduleRoundIfDue();
	}
}

install();
