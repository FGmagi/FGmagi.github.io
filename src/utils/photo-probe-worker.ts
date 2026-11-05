

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
