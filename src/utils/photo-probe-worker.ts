/**
 * 相册图片「尺寸探测」Worker（26.09.14 新增，任务：图片页外链不可达时卡死）。
 *
 * 为什么独立线程：相册详情页外链动辄几十上百条，逐一 Range 探测头字节 + 解析文件头
 * （JPEG/PNG/WebP/AVIF 的 box 遍历）此前全部跑在主线程上；外链不可达时更要等网络超时。
 * 把「发请求 + 解析头字节」整体搬进 Worker，主线程只接收 {key,w,h} 结果并写缓存，
 * 布局/交互因此不被探测过程占住（UI 线程与探测线程分离）。
 *
 * 硬性约束：
 *  - 只读头部字节（photo-size 的 Range 探测），绝不全量下载图片内容；
 *  - 全局截止 deadlineMs：到点立即收工（同时断掉在途请求，避免被单请求超时拖住），
 *    未探测出来的项由主线程按默认宽高比占位，保证相册一定能在有限时间内进入
 *    「已排版占位 + 逐张懒加载」阶段（不会卡在尺寸期）；
 *  - 可取消：主线程 abort 时发 cancel，Worker 终止在途请求并停止取新任务。
 *
 * 协议（postMessage）：
 *   主→W  { type:"probe", batchId, jobs:[{key,src}], concurrency, timeoutMs, deadlineMs }
 *   主→W  { type:"cancel", batchId }
 *   W→主  { type:"result", batchId, key, w, h }
 *   W→主  { type:"done", batchId }
 */

import { fetchHeaderSize } from "./photo-size.js";

interface ProbeJob {
	key: string;
	src: string;
}

interface ProbeRequest {
	type: "probe";
	batchId: number;
	jobs: ProbeJob[];
	concurrency?: number;
	timeoutMs?: number;
	deadlineMs?: number;
}

interface CancelRequest {
	type: "cancel";
	batchId: number;
}

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_DEADLINE_MS = 6000;

/** 已取消批次：批次内所有循环在看到它后立刻停止。 */
const cancelled = new Set<number>();
/** 批次 → 在途请求的 AbortController，用于 cancel 时主动终止请求（尽快释放连接）。 */
const inflight = new Map<number, Set<AbortController>>();

function post(message: unknown): void {
	// Worker 全局 self 上才有 postMessage；用类型断言避免 dom/webworker lib 冲突
	(self as unknown as { postMessage(m: unknown): void }).postMessage(message);
}

function abortBatch(batchId: number): void {
	const set = inflight.get(batchId);
	if (!set) return;
	for (const ctrl of set) {
		try {
			ctrl.abort();
		} catch {
			/* 忽略 */
		}
	}
	set.clear();
}

async function runBatch(req: ProbeRequest): Promise<void> {
	const batchId = req.batchId;
	const jobs = Array.isArray(req.jobs) ? req.jobs : [];
	const concurrency = Math.max(
		1,
		Math.min(req.concurrency ?? DEFAULT_CONCURRENCY, 8),
	);
	const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const deadlineMs = req.deadlineMs ?? DEFAULT_DEADLINE_MS;
	const startedAt = Date.now();

	const set = inflight.get(batchId) ?? new Set<AbortController>();
	inflight.set(batchId, set);

	// 到点即收工：先断掉在途请求（否则 done 要等各自的单请求超时，整批收尾被拖长）
	let stopped = false;
	let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
	const stop = (): void => {
		stopped = true;
		abortBatch(batchId);
	};
	if (deadlineMs > 0) deadlineTimer = setTimeout(stop, deadlineMs);

	let cursor = 0;
	const worker = async (): Promise<void> => {
		for (;;) {
			if (stopped || cancelled.has(batchId)) return;
			// 双保险：定时器之外再按时刻判断（事件循环被占住时也能及时退出）
			if (deadlineMs > 0 && Date.now() - startedAt > deadlineMs) {
				stop();
				return;
			}
			const idx = cursor++;
			if (idx >= jobs.length) return;
			const job = jobs[idx];
			if (!job || !job.src) continue;

			const ctrl = new AbortController();
			set.add(ctrl);
			try {
				const dim = await fetchHeaderSize(job.src, {
					signal: ctrl.signal,
					timeoutMs,
				});
				if (dim && !stopped && !cancelled.has(batchId)) {
					post({
						type: "result",
						batchId,
						key: job.key,
						w: dim.w,
						h: dim.h,
					});
				}
			} catch {
				/* 单项失败继续下一项 */
			} finally {
				set.delete(ctrl);
			}
		}
	};

	try {
		await Promise.all(
			Array.from(
				{ length: Math.min(concurrency, Math.max(jobs.length, 1)) },
				() => worker(),
			),
		);
	} finally {
		if (deadlineTimer) clearTimeout(deadlineTimer);
		set.clear();
		inflight.delete(batchId);
		cancelled.delete(batchId);
	}
	post({ type: "done", batchId });
}

self.addEventListener("message", (event: Event) => {
	const data = (event as MessageEvent).data as
		| ProbeRequest
		| CancelRequest
		| null;
	if (!data || typeof data !== "object") return;
	if (data.type === "cancel") {
		cancelled.add(data.batchId);
		abortBatch(data.batchId);
		return;
	}
	if (data.type === "probe") {
		void runBatch(data);
	}
});
