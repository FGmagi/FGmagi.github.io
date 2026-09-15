/**
 * 相册图片尺寸「批量探测」主线程门面（26.09.14 新增）。
 *
 * 职责：把尺寸探测整体交给 Web Worker（photo-probe-worker），主线程只接收结果回调，
 * 保证外链不可达（连接长时间无响应）时 UI 线程不被探测过程占住；同时提供三重收敛保证：
 *   ① Worker 内全局截止 deadlineMs —— 到点收工；
 *   ② 客户端截止 deadlineMs + 1s —— Worker 卡住/消息丢失也能收敛；
 *   ③ Worker 创建失败（旧浏览器 / CSP）→ 自动降级为主线程小并发探测；
 *   ④ signal abort → 终止 Worker（连在途请求一起断掉，绝不让悬挂请求继续占用连接）。
 *
 * 消费方：album-gallery（相册详情页尺寸期）、album-prefetch（非相册页空闲预计算）。
 */

import { fetchHeaderSize } from "./photo-size.js";

export interface PhotoProbeJob {
	key: string;
	src: string;
}

export interface PhotoProbeOptions {
	/** 外部中止信号（页面离开 / 切页）：触发即取消整个批次 */
	signal?: AbortSignal;
	/** 并发上限（默认 4） */
	concurrency?: number;
	/** 单次 Range 请求超时（默认 8000ms） */
	timeoutMs?: number;
	/** 整批探测的全局截止（默认 6000ms；到点未完成的项按未探测处理） */
	deadlineMs?: number;
	/** 每探到一项即回调（主线程侧负责写 photo-cache / 应用尺寸） */
	onResult?: (key: string, w: number, h: number) => void;
}

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_DEADLINE_MS = 6000;

interface PendingBatch {
	onResult?: (key: string, w: number, h: number) => void;
	finish: () => void;
}

let worker: Worker | null = null;
let workerUnavailable = false;
let batchSeq = 0;
const pending = new Map<number, PendingBatch>();

function isBrowser(): boolean {
	return typeof window !== "undefined" && typeof document !== "undefined";
}

/** 丢弃当前 Worker（含在途请求）并解除「损坏」状态，下次调用会重新创建。 */
function dropWorker(): void {
	if (worker) {
		try {
			worker.terminate();
		} catch {
			/* 忽略 */
		}
	}
	worker = null;
}

function settleAllPending(): void {
	const entries = Array.from(pending.values());
	pending.clear();
	entries.forEach((entry) => entry.finish());
}

function handleWorkerMessage(event: MessageEvent): void {
	const data = event.data as
		| { type: "result"; batchId: number; key: string; w: number; h: number }
		| { type: "done"; batchId: number }
		| null;
	if (!data) return;
	const entry = pending.get(data.batchId);
	if (!entry) return;
	if (data.type === "result") {
		if (data.w > 0 && data.h > 0) entry.onResult?.(data.key, data.w, data.h);
		return;
	}
	if (data.type === "done") {
		pending.delete(data.batchId);
		entry.finish();
	}
}

/** Worker 加载/运行失败：降级为主线程探测（不抛错，探测失败即未探测）。 */
function handleWorkerError(): void {
	workerUnavailable = true;
	dropWorker();
	settleAllPending();
}

function getWorker(): Worker | null {
	if (!isBrowser() || workerUnavailable) return null;
	if (worker) return worker;
	try {
		if (typeof Worker === "undefined") {
			workerUnavailable = true;
			return null;
		}
		worker = new Worker(new URL("./photo-probe-worker.ts", import.meta.url), {
			type: "module",
			name: "photo-probe",
		});
		worker.addEventListener("message", handleWorkerMessage);
		worker.addEventListener("error", handleWorkerError);
		return worker;
	} catch {
		workerUnavailable = true;
		worker = null;
		return null;
	}
}

/**
 * 主线程降级探测：Worker 不可用时使用（并发压低，避免抢占主线程与带宽）。
 */
async function probeInline(
	jobs: PhotoProbeJob[],
	options: PhotoProbeOptions,
): Promise<void> {
	const signal = options.signal;
	if (signal?.aborted) return;
	const concurrency = Math.max(
		1,
		Math.min(options.concurrency ?? DEFAULT_CONCURRENCY, 8),
	);
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS;
	const startedAt = Date.now();
	let cursor = 0;
	const run = async (): Promise<void> => {
		for (;;) {
			if (signal?.aborted) return;
			if (deadlineMs > 0 && Date.now() - startedAt > deadlineMs) return;
			const idx = cursor++;
			if (idx >= jobs.length) return;
			const job = jobs[idx];
			if (!job || !job.src) continue;
			try {
				const dim = await fetchHeaderSize(job.src, { signal, timeoutMs });
				if (dim && !signal?.aborted) {
					options.onResult?.(job.key, dim.w, dim.h);
				}
			} catch {
				/* 单项失败继续 */
			}
		}
	};
	await Promise.all(
		Array.from(
			{ length: Math.min(concurrency, Math.max(jobs.length, 1)) },
			() => run(),
		),
	);
}

/**
 * 批量探测外链图片尺寸。返回的 Promise 在「全部完成 / 到点 / 被取消」时 resolve，
 * 绝不 reject（探测失败不属于调用方需要处理的错误，按未探测继续即可）。
 */
export function probePhotoSizes(
	jobs: PhotoProbeJob[],
	options: PhotoProbeOptions = {},
): Promise<void> {
	const list = (jobs || []).filter((job) => job && job.key && job.src);
	if (list.length === 0) return Promise.resolve();
	if (options.signal?.aborted) return Promise.resolve();

	const target = getWorker();
	if (!target) return probeInline(list, options);

	const batchId = ++batchSeq;
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS;
	const concurrency = Math.max(
		1,
		Math.min(options.concurrency ?? DEFAULT_CONCURRENCY, 8),
	);

	return new Promise<void>((resolve) => {
		let settled = false;
		let clientTimer: ReturnType<typeof setTimeout> | null = null;
		const signal = options.signal;

		const cleanup = (): void => {
			if (clientTimer) clearTimeout(clientTimer);
			clientTimer = null;
			signal?.removeEventListener("abort", onAbort);
		};
		const finish = (): void => {
			if (settled) return;
			settled = true;
			pending.delete(batchId);
			cleanup();
			resolve();
		};
		function onAbort(): void {
			// 终止 Worker：在途 Range 请求随之断开，避免悬挂请求继续占连接
			dropWorker();
			finish();
		}

		pending.set(batchId, { onResult: options.onResult, finish });
		if (signal) signal.addEventListener("abort", onAbort, { once: true });

		try {
			target.postMessage({
				type: "probe",
				batchId,
				jobs: list,
				concurrency,
				timeoutMs,
				deadlineMs,
			});
		} catch {
			handleWorkerError();
			void probeInline(list, options).then(finish);
			return;
		}

		// 客户端兜底截止：Worker 内的截止之外再留 1s 余量
		clientTimer = setTimeout(
			() => {
				dropWorker();
				finish();
			},
			Math.max(0, deadlineMs) + 1000,
		);
	});
}

/** 仅供诊断/测试：当前 Worker 是否可用（不创建）。 */
export function isPhotoProbeWorkerActive(): boolean {
	return worker !== null && !workerUnavailable;
}
