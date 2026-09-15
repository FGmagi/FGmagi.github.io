/**
 * 相册图片「取图 + 解码」主线程门面（26.09.14 新增）。
 *
 * 职责：把「下载整张图 + 解码成位图」整体交给 photo-bitmap-worker，主线程只 await 一个
 * ImageBitmap（零拷贝 transfer 回来）后 drawImage 一次。外链不可达 / 解码失败时返回 null，
 * 调用方回退到既有 <img> 路径 —— 功能不降级，只是那条路继续走渲染进程解码。
 *
 * 收敛保证（与 photo-probe-client 同构）：
 *   ① 每个 job 有独立超时：单张外链悬挂不会拖住整批（此前的坑：整批一个 deadline，
 *      未探出的项一起等，表现为整页卡死）；
 *   ② 客户端兜底截止 = job 超时 + 2s：Worker 卡住/消息丢失也能收敛；
 *   ③ Worker 创建失败 / 运行错误（旧浏览器、CSP）→ 标记不可用并 settle 所有等待者（返回 null）；
 *   ④ abort / cancelPhotoBitmap() → 向 Worker 发 cancel 并立即 settle，绝不让主线程干等。
 *
 * 绝不长期持有：调用方在不需要时调用 cancelPhotoBitmap(jobId)。
 */

export interface PhotoBitmapJob {
	jobId: number;
	src: string;
	/** 单张图超时（默认 15000ms） */
	timeoutMs?: number;
}

interface Waiter {
	finish: (bitmap: ImageBitmap | null) => void;
	drop: () => void;
}

const DEFAULT_TIMEOUT_MS = 15000;
/** 客户端兜底：在 job 超时之上再留的余量 */
const CLIENT_GRACE_MS = 2000;

let worker: Worker | null = null;
let workerUnavailable = false;
let seq = 0;
const waiters = new Map<number, Waiter>();

function isBrowser(): boolean {
	return (
		typeof window !== "undefined" &&
		typeof document !== "undefined" &&
		typeof Worker !== "undefined"
	);
}

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

/** Worker 掉线：所有等待者按「没有位图」收尾，调用方回退 <img> */
function settleAll(): void {
	const entries = Array.from(waiters.values());
	waiters.clear();
	for (const waiter of entries) {
		try {
			waiter.finish(null);
		} catch {
			/* 调用方自身异常不影响其它等待者 */
		}
	}
}

function handleMessage(event: MessageEvent): void {
	const data = event.data as
		| {
				type: "done";
				jobId: number;
				ok: boolean;
				bitmap?: ImageBitmap;
				reason?: string;
		  }
		| null;
	if (!data || data.type !== "done") return;
	const waiter = waiters.get(data.jobId);
	if (!waiter) {
		// 已被取消/已收尾：位图必须立刻释放，避免显存泄漏
		if (data.bitmap) {
			try {
				data.bitmap.close();
			} catch {
				/* 忽略 */
			}
		}
		return;
	}
	waiters.delete(data.jobId);
	waiter.drop();
	waiter.finish(data.ok && data.bitmap ? data.bitmap : null);
}

function handleWorkerError(): void {
	workerUnavailable = true;
	dropWorker();
	settleAll();
}

function getWorker(): Worker | null {
	if (!isBrowser() || workerUnavailable) return null;
	if (worker) return worker;
	try {
		worker = new Worker(new URL("./photo-bitmap-worker.ts", import.meta.url), {
			type: "module",
			name: "photo-bitmap",
		});
		worker.addEventListener("message", handleMessage);
		worker.addEventListener("error", handleWorkerError);
		return worker;
	} catch {
		workerUnavailable = true;
		worker = null;
		return null;
	}
}

/**
 * 取一张图的位图。成功 → ImageBitmap（调用方负责在不需要时 close 或交给 canvas）；
 * 失败 / Worker 不可用 → null（调用方回退 <img src>）。
 * 绝不 reject。
 */
export function fetchPhotoBitmap(job: PhotoBitmapJob): Promise<ImageBitmap | null> {
	const jobId = job.jobId;
	const target = getWorker();
	if (!target) return Promise.resolve(null);

	const timeoutMs =
		typeof job.timeoutMs === "number" && job.timeoutMs > 0
			? job.timeoutMs
			: DEFAULT_TIMEOUT_MS;

	return new Promise<ImageBitmap | null>((resolve) => {
		let settled = false;
		let timer: ReturnType<typeof setTimeout> | null = null;

		const cleanup = (): void => {
			if (timer) clearTimeout(timer);
			timer = null;
		};
		const finish = (bitmap: ImageBitmap | null): void => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve(bitmap);
		};
		const cancelInWorker = (): void => {
			try {
				worker?.postMessage({ type: "cancel", jobId });
			} catch {
				/* 忽略 */
			}
		};

		waiters.set(jobId, {
			finish,
			drop: cleanup,
		});

		try {
			target.postMessage({
				type: "job",
				jobId,
				src: job.src,
				timeoutMs,
			});
		} catch {
			waiters.delete(jobId);
			handleWorkerError();
			finish(null);
			return;
		}

		// 客户端兜底：Worker 无响应（消息丢失 / 内部卡死）也必须在有限时间内收尾
		timer = setTimeout(() => {
			waiters.delete(jobId);
			cancelInWorker();
			finish(null);
		}, timeoutMs + CLIENT_GRACE_MS);
	});
}

/** 取消一个 job（页面离开 / 切页 / 队列让位）：主线程立即收尾，Worker 内在途请求 abort */
export function cancelPhotoBitmap(jobId: number): void {
	const waiter = waiters.get(jobId);
	const has = waiters.delete(jobId);
	try {
		worker?.postMessage({ type: "cancel", jobId });
	} catch {
		/* 忽略 */
	}
	if (has && waiter) waiter.finish(null);
}

/** 诊断/预热：创建 Worker（失败即标记不可用，后续全部走回退路径） */
export function warmUpPhotoBitmap(): boolean {
	return getWorker() !== null;
}

/** 仅供诊断/测试：当前 Worker 是否可用（不创建） */
export function isPhotoBitmapWorkerActive(): boolean {
	return worker !== null && !workerUnavailable;
}

/** 下一个 jobId（模块内自增，避免调用方自行管理冲突） */
export function nextPhotoBitmapJobId(): number {
	return ++seq;
}
