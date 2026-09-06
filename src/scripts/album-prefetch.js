/**
 * 相册图片尺寸「空闲预计算」（B 任务）：在非相册页空闲时提前计算所有相册图片的尺寸。
 *
 * 硬性约束：
 *  - 严禁提前加载图片内容 —— 只走 manifest + Range 头字节探测（photo-size），绝不全量下载；
 *  - 渐进分批、可中止 —— requestIdleCallback（降级 setTimeout）+ AbortController：
 *    离开/隐藏/切页中止；当前关注相册优先（即不抢占相册页自身渲染，探测并发压低）；
 *  - 尺寸一律入 localStorage（photo-cache，mzAlbumPhoto: 命名空间），与 A 共用同一套尺寸
 *    获取 + 缓存；运行期绝不回写构建产物。
 *
 * 注册时机：模块顶层只注册一次；但「只在用户首次进入相册相关页后」才真正开始预计算
 * （sessionStorage 记录），避免从未关心相册的访客产生无谓的 Range 请求。
 * manifest 获取带 404 / 结构守卫（predev 不产出文件时静默跳过）。
 */

import { getSize, setSize, prune, sweepByKeys } from "../utils/photo-cache.js";
import { fetchHeaderSize } from "../utils/photo-size.js";

const MANIFEST_URL = "/data/photo-meta.json";
const PROBE_CONCURRENCY = 3; // 预计算把带宽让给用户浏览，并发压得比相册页低
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

async function probeDim(key, src, signal) {
	const dim = await fetchHeaderSize(src, { signal, timeoutMs: 12000 });
	if (signal.aborted) return;
	if (dim) setSize(key, dim.w, dim.h);
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

	// 候选 = manifest 中构建期未知、又不在 localStorage 缓存的外链图
	const tasks = [];
	for (const album of data.albums) {
		if (!album || !album.id) continue;
		if (!Array.isArray(album.photos)) continue;
		for (const photo of album.photos) {
			if (!photo || !photo.key || !photo.src) continue;
			if (photo.w > 0 && photo.h > 0) continue; // 构建期已知，无需预计算
			if (!/^https?:\/\//i.test(photo.src)) continue;
			if (getSize(photo.key)) continue; // 缓存已有
			tasks.push({ key: photo.key, src: photo.src });
		}
	}

	// 渐进分批（小并发）+ 可中止：绝不全量下载
	let cursor = 0;
	const workers = Array.from(
		{ length: Math.min(PROBE_CONCURRENCY, tasks.length) },
		async () => {
			for (;;) {
				if (signal.aborted) return;
				const idx = cursor++;
				if (idx >= tasks.length) return;
				try {
					await probeDim(tasks[idx].key, tasks[idx].src, signal);
				} catch {
					/* 单项失败继续 */
				}
			}
		},
	);
	await Promise.all(workers);
	if (signal.aborted) return;
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

	// 首载
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
