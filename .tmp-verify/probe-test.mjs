/**
 * 临时验证脚本（验证完成后删除）：外链不可达时，相册尺寸探测的行为对比。
 *
 * 被测的「新版」直接加载构建产物 dist/_astro/photo-probe-worker-*.js（真实上线代码，
 * 用 stub self 在 Node 里驱动）；「旧版」按 HEAD 的 src/utils/photo-size.ts 逐行等价移植，
 * 用来量化旧实现「网络失败也逐级放大窗口重试」造成的请求放大。
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

// ===================== 旧版实现（等价移植 HEAD:src/utils/photo-size.ts） =====================
const PROBE_WINDOWS = [65536, 262144, 1048576];
function parsePngSize(b) {
	if (b.length < 24 || b[0] !== 0x89 || b[1] !== 0x50) return null;
	const w = (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19];
	const h = (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23];
	return w > 0 && h > 0 ? { w, h } : null;
}
async function oldProbeRange(url, size, timeoutMs, counter) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		counter.n++;
		const res = await fetch(url, {
			headers: { Range: `bytes=0-${size - 1}` },
			signal: controller.signal,
		});
		if (!res || (res.status !== 200 && res.status !== 206)) return null;
		if (!res.body || typeof res.body.getReader !== "function") return null;
		const reader = res.body.getReader();
		const chunks = [];
		let total = 0;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value) {
				chunks.push(value);
				total += value.length;
			}
			if (total >= size) break;
		}
		reader.cancel().catch(() => {});
		if (total === 0) return null;
		const out = new Uint8Array(Math.min(total, size));
		out.set(chunks[0].subarray(0, Math.min(chunks[0].length, out.length)), 0);
		return out.subarray(0, Math.min(total, size));
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}
/** 旧版 fetchHeaderSize：网络失败（返回 null）也会继续放大窗口重试。 */
async function oldFetchHeaderSize(url, timeoutMs, counter) {
	for (const size of PROBE_WINDOWS) {
		const got = await oldProbeRange(url, size, timeoutMs, counter);
		if (got === "unsupported") return null;
		if (got) {
			const dim = parsePngSize(got);
			if (dim) return dim;
		}
	}
	return null;
}

// ===================== 新版：加载构建产物 worker =====================
const workerFile = fs
	.readdirSync(path.join(root, "dist/_astro"))
	.find((n) => /photo-probe-worker-.*\.js$/.test(n));
if (!workerFile) throw new Error("dist 里找不到 photo-probe-worker chunk");
const posted = [];
const postedAt = new Map();
let onMessage = null;
globalThis.self = {
	addEventListener: (type, fn) => {
		if (type === "message") onMessage = fn;
	},
	postMessage: (m) => {
		posted.push(m);
		postedAt.set(m, Date.now());
	},
};
await import(
	pathToFileURL(path.join(root, "dist/_astro", workerFile)).href
);
if (!onMessage) throw new Error("worker 未注册 message 监听");

// ===================== 本地「只连不答」服务器 =====================
let hits = 0;
const hang = http.createServer((_req, res) => {
	hits++;
	void res; // 故意不响应
});
await new Promise((r) => hang.listen(0, "127.0.0.1", r));
const hangBase = `http://127.0.0.1:${hang.address().port}`;

const results = { workerChunk: workerFile };

// ---------- A. 单图：旧版 vs 新版（Worker）请求次数 ----------
const counter = { n: 0 };
let t0 = Date.now();
const oldDim = await oldFetchHeaderSize(`${hangBase}/a.jpg`, 300, counter);
results.single_hanging = {
	old: { dim: oldDim, requests: counter.n, ms: Date.now() - t0 },
};
hits = 0;
t0 = Date.now();
posted.length = 0;
const singleBatchStart = t0;
onMessage({
	data: {
		type: "probe",
		batchId: 1,
		jobs: [{ key: "k", src: `${hangBase}/a.jpg` }],
		concurrency: 1,
		timeoutMs: 300,
		deadlineMs: 5000,
	},
});
await new Promise((r) => setTimeout(r, 900));
const singleDone = posted.find((m) => m.type === "done" && m.batchId === 1);
results.single_hanging.new = {
	requests: hits,
	doneMs: singleDone ? postedAt.get(singleDone) - singleBatchStart : null,
	done: !!singleDone,
	results: posted.filter((m) => m.type === "result").length,
};

// ---------- B. 整批 12 张悬挂图：Worker 全局截止 ----------
hits = 0;
posted.length = 0;
t0 = Date.now();
const batchStart = t0;
const jobs = Array.from({ length: 12 }, (_, i) => ({
	key: `k${i}`,
	src: `${hangBase}/img${i}.jpg`,
}));
onMessage({
	data: {
		type: "probe",
		batchId: 2,
		jobs,
		concurrency: 3,
		timeoutMs: 5000,
		deadlineMs: 600,
	},
});
await new Promise((r) => setTimeout(r, 2500));
const batchDone = posted.find((m) => m.type === "done" && m.batchId === 2);
results.batch_hanging_deadline = {
	doneMs: batchDone ? postedAt.get(batchDone) - batchStart : null,
	requestsStarted: hits,
	resultsPosted: posted.filter((m) => m.type === "result").length,
	note: "deadline=600ms，单请求 timeout=5000ms；旧逻辑此处要等 3 波 × 5s 超时",
};

// ---------- C. 正常 PNG：探测本身仍然有效 ----------
const PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
	"base64",
);
const ok = http.createServer((_req, res) => {
	res.writeHead(206, {
		"Content-Type": "image/png",
		"Content-Range": `bytes 0-${PNG.length - 1}/${PNG.length}`,
	});
	res.end(PNG);
});
await new Promise((r) => ok.listen(0, "127.0.0.1", r));
const okUrl = `http://127.0.0.1:${ok.address().port}/ok.png`;
posted.length = 0;
onMessage({
	data: {
		type: "probe",
		batchId: 3,
		jobs: [{ key: "ok", src: okUrl }],
		concurrency: 1,
		timeoutMs: 2000,
		deadlineMs: 3000,
	},
});
await new Promise((r) => setTimeout(r, 600));
results.ok_png = {
	results: posted.filter((m) => m.type === "result").map((m) => ({ key: m.key, w: m.w, h: m.h })),
	done: posted.some((m) => m.type === "done" && m.batchId === 3),
};

// ---------- D. 取消：悬挂批次的 cancel 是否即时收工 ----------
hits = 0;
posted.length = 0;
onMessage({
	data: {
		type: "probe",
		batchId: 4,
		jobs,
		concurrency: 3,
		timeoutMs: 5000,
		deadlineMs: 8000,
	},
});
await new Promise((r) => setTimeout(r, 200));
t0 = Date.now();
onMessage({ data: { type: "cancel", batchId: 4 } });
await new Promise((r) => setTimeout(r, 400));
results.cancel = {
	doneAfterCancelMs: Date.now() - t0,
	hitsAfterCancelWindow: hits,
	done: posted.some((m) => m.type === "done" && m.batchId === 4),
};

console.log(JSON.stringify(results, null, 2));
hang.close();
ok.close();
process.exit(0);
