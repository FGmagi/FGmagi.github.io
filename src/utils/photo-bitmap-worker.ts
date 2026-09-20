/**
 * 相册图片「取图 + 解码」Worker（26.09.14 新增，任务：图片页外链不可达时卡死 —— UI 线程分离）。
 *
 * 背景（与 photo-probe-worker 的分工）：
 *   - photo-probe-worker：只读文件头字节，解决「尺寸探测」占住主线程的问题；
 *   - 本 Worker：把「整张图的下载 + 解码」也搬离 UI 线程。
 *     此前相册页每张图都是主线程把 src 交给 <img>，浏览器在渲染进程里解码几十上百张外链图；
 *     外链不可达时连接长时间挂着、解码峰谷又与滚动/布局重叠，整页表现为「卡死」。
 *     现在：Worker 内 fetch → createImageBitmap 解码 → ImageBitmap 零拷贝 transfer 回主线程，
 *     主线程只做一次 drawImage（合成），不再承担解码与网络等待。
 *
 * 协议（postMessage）：
 *   主→W  { type:"job", jobId, src, timeoutMs }       取图并解码一张
 *   主→W  { type:"cancel", jobId }                    取消（对在途请求 abort；对已完成结果 close）
 *   W→主  { type:"done", jobId, ok:true, bitmap }      成功：ImageBitmap（transfer，零拷贝）
 *   W→主  { type:"done", jobId, ok:false, reason }     失败：主线程回退到 <img> 路径
 *
 * 约束：
 *  - 绝不长期持有解码结果：主线程取消或已 closed 的 jobId 会被立即 close()，避免显存/内存泄漏；
 *  - 主线程取消后在途 fetch 立即 abort（外链不可达时不再占连接）；
 *  - createImageBitmap 不可用 / decode 失败 → 一律 ok:false，调用方回退，功能不降级。
 */

/** 同时进行的「取图 + 解码」上限（Worker 内生效） */
const MAX_WORKERS = 4;
/** 单张图默认超时：外链不可达时保证有限时间内收尾 */
const DEFAULT_TIMEOUT_MS = 15000;

interface BitmapJobRequest {
	type: "job";
	jobId: number;
	src: string;
	timeoutMs?: number;
}

interface BitmapCancelRequest {
	type: "cancel";
	jobId: number;
}

interface Inflight {
	controller: AbortController;
	timer: ReturnType<typeof setTimeout> | null;
}

/** 在途请求（可被 cancel 中断） */
const inflight = new Map<number, Inflight>();
/** 已取消的 job：结果回来时直接丢弃并 close() */
const cancelled = new Set<number>();

function post(message: unknown, transfer?: Transferable[]): void {
	const self_ = self as unknown as {
		postMessage(m: unknown, t?: Transferable[]): void;
	};
	if (transfer && transfer.length > 0) self_.postMessage(message, transfer);
	else self_.postMessage(message);
}

function releaseInflight(jobId: number): void {
	const entry = inflight.get(jobId);
	if (!entry) return;
	if (entry.timer) clearTimeout(entry.timer);
	inflight.delete(jobId);
}

function bitmapSupported(): boolean {
	return typeof createImageBitmap === "function";
}

async function handleJob(jobId: number, src: string, timeoutMs: number): Promise<void> {
	if (!src) {
		post({ type: "done", jobId, ok: false, reason: "empty-src" });
		return;
	}
	if (!bitmapSupported()) {
		post({ type: "done", jobId, ok: false, reason: "no-createImageBitmap" });
		return;
	}

	const controller = new AbortController();
	const timer = setTimeout(() => {
		try {
			controller.abort();
		} catch {
			/* 忽略 */
		}
	}, timeoutMs);
	inflight.set(jobId, { controller, timer });

	try {
		const res = await fetch(src, {
			signal: controller.signal,
			credentials: "omit",
			mode: "cors",
			cache: "force-cache",
		});
		if (!res || !res.ok) throw new Error(`http-${res ? res.status : 0}`);
		const blob = await res.blob();
		// 显式指定 MIME：blob 的 type 在个别 CDN 上为空，交给 createImageBitmap 嗅探即可
		const bitmap = await createImageBitmap(blob);
		if (cancelled.has(jobId)) {
			try {
				bitmap.close();
			} catch {
				/* 忽略 */
			}
			return;
		}
		// 零拷贝转移给主线程
		post({ type: "done", jobId, ok: true, bitmap }, [bitmap]);
	} catch (error) {
		const reason = (error as Error)?.name === "AbortError" ? "aborted" : "failed";
		try {
			controller.abort();
		} catch {
			/* 忽略 */
		}
		post({ type: "done", jobId, ok: false, reason });
	} finally {
		releaseInflight(jobId);
		cancelled.delete(jobId);
	}
}

/** 简单并发闸门：同时最多 MAX_WORKERS 张 */
let running = 0;
const waiting: Array<() => void> = [];

function acquire(): Promise<void> {
	if (running < MAX_WORKERS) {
		running++;
		return Promise.resolve();
	}
	return new Promise<void>((resolve) => {
		waiting.push(() => {
			running++;
			resolve();
		});
	});
}

function release(): void {
	running = Math.max(0, running - 1);
	const next = waiting.shift();
	if (next) next();
}

self.addEventListener("message", (event: Event) => {
	const data = (event as MessageEvent).data as
		| BitmapJobRequest
		| BitmapCancelRequest
		| null;
	if (!data || typeof data !== "object") return;

	if (data.type === "cancel") {
		cancelled.add(data.jobId);
		const entry = inflight.get(data.jobId);
		if (entry) {
			try {
				entry.controller.abort();
			} catch {
				/* 忽略 */
			}
			releaseInflight(data.jobId);
		}
		return;
	}

	if (data.type === "job") {
		const jobId = data.jobId;
		const timeoutMs =
			typeof data.timeoutMs === "number" && data.timeoutMs > 0
				? data.timeoutMs
				: DEFAULT_TIMEOUT_MS;
		void acquire().then(() => {
			if (cancelled.has(jobId)) {
				cancelled.delete(jobId);
				release();
				return;
			}
			void handleJob(jobId, data.src, timeoutMs).finally(() => release());
		});
	}
});

// 本文件是 `new Worker(..., { type: "module" })` 加载的 ES 模块；
// 显式导出一个空对象让 TS 也按模块解析 —— 否则它被当成全局脚本，
// 顶层 `running` 会与其它脚本里的同名全局变量冲突（astro check 报 6 处类型错误）。
export {};
