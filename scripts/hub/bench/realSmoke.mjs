// H3-2：最小真實 Ollama 測試（必須經主人批准才能執行）
//   node scripts/hub/bench/realSmoke.mjs --out docs/hub/h3-2-real-smoke.json
//
// 只送 2 個推論請求：① 一般請求 ② 中途取消的請求。不重試。
// - 使用獨立的測試 Hub（暫存資料夾、測試通行碼、隨機埠）與合成玩家；不經過運作中的轉接服務
// - 模型必須是 gemma3:4b、digest 固定、清單中沒有遠端欄位，否則在送出任何推論前停止
// - 不下載模型、不改 Ollama 設定、不重啟 Ollama
// - 觀察：Ollama 自己的計時欄位、GPU 使用率（nvidia-smi 唯讀查詢，每 0.1 秒）、Ollama 與子程序的 CPU 時間

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRelay } from '../../ai-proxy.mjs';
import { createHub } from '../hub.mjs';
import { ollamaAdapter, verifyLocalModel } from '../localai.mjs';

const MODEL = 'gemma3:4b';
const DIGEST = '68ceab7e468a31c988b44d5a4984a0e21f58c4f7158c6ce29c1804babac38df7';
// --fake：用假 Ollama（真實清單格式）先演練一次，確認工具本身沒問題（不碰真正的 Ollama）
const FAKE = process.argv.includes('--fake');
let fakeSrv = null;
if (FAKE) {
  const { startFakeOllama } = await import('./fakeOllama.mjs');
  const fx = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../test/fixtures/ollama-tags-2026-11-06.json'), 'utf8'));
  fakeSrv = await startFakeOllama({ models: fx.models, latencyMs: () => 1500 });
}
const OLLAMA = FAKE ? `http://127.0.0.1:${fakeSrv.port}` : 'http://127.0.0.1:11434';
const FP_TOKEN = 'smoke-fp-token-0001';
const MC_TOKEN = 'smoke-mc-token-0002';
const ACTOR = 'java:5a0e0000-0000-4000-8000-00000000000a'; // 合成玩家
const outFile = (() => {
  const i = process.argv.indexOf('--out');
  return i >= 0 ? process.argv[i + 1] : null;
})();
const T0 = Date.now();
const rel = () => Date.now() - T0;
const report = { startedAt: new Date(T0).toISOString(), steps: [], inferenceCalls: 0, stopped: null };
const step = (name, data) => {
  report.steps.push({ t: rel(), name, ...data });
  console.log(`[${(rel() / 1000).toFixed(2)}s] ${name}`, data ? JSON.stringify(data) : '');
};
const getJson = async (p) => (await fetch(OLLAMA + p, { signal: AbortSignal.timeout(10_000) })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 整體上限 120 秒
const guard = setTimeout(() => {
  report.stopped = 'overall_timeout_120s';
  finish(2);
}, 120_000);

let gpu = null;
const gpuSamples = [];
let tmpDir = null;
let relay = null;

/**
 * Ollama 主程序與它的子程序（推論 runner）的累計 CPU 毫秒（唯讀）。
 * 非同步取樣：不阻塞事件迴圈，GPU 取樣的時間戳才準（2026-11-06 第一次實測時是同步的，造成 GPU 時間戳成批延遲）。
 */
function ollamaProcs() {
  const ps = `$m = Get-CimInstance Win32_Process -Filter "Name = 'ollama.exe'"; $ids = @($m | ForEach-Object { $_.ProcessId }); $all = Get-CimInstance Win32_Process | Where-Object { $ids -contains $_.ProcessId -or $ids -contains $_.ParentProcessId }; $all | ForEach-Object { $p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; '{0}|{1}|{2}|{3}' -f $_.ProcessId, $_.ParentProcessId, $_.Name, [math]::Round($p.TotalProcessorTime.TotalMilliseconds) }`;
  return new Promise((resolve) => {
    const c = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps]);
    let out = '';
    c.stdout.setEncoding('utf8');
    c.stdout.on('data', (d) => (out += d));
    const t = setTimeout(() => c.kill(), 15_000);
    c.on('close', () => {
      clearTimeout(t);
      resolve(
        out.trim().split(/\r?\n/).filter(Boolean).map((l) => {
          const [pid, ppid, name, cpuMs] = l.split('|');
          return { pid: Number(pid), ppid: Number(ppid), name, cpuMs: Number(cpuMs) };
        }),
      );
    });
  });
}

async function finish(code = 0) {
  clearTimeout(guard);
  try {
    gpu?.kill();
  } catch {
    /* 已結束 */
  }
  try {
    relay?.closeAllConnections?.();
    await new Promise((r) => (relay ? relay.close(() => r()) : r()));
  } catch {
    /* 已關閉 */
  }
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  if (fakeSrv) await fakeSrv.close();
  report.mode = FAKE ? 'fake' : 'real';
  report.gpuSamples = gpuSamples;
  report.endedAt = new Date().toISOString();
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(report, null, 1));
  console.log(`結束：推論請求 ${report.inferenceCalls} 次${report.stopped ? `，停止原因 ${report.stopped}` : ''}`);
  process.exit(code);
}

// ---------- 0. 事前檢查（唯讀，不推論） ----------
const version = await getJson('/api/version');
const tags = await getJson('/api/tags');
const psBefore = await getJson('/api/ps');
const check = verifyLocalModel(tags, MODEL, [MODEL], DIGEST);
const remote = (tags.models ?? []).filter((m) => 'remote_host' in m || 'remote_model' in m).map((m) => m.name);
step('preflight', { version: version.version, models: (tags.models ?? []).map((m) => m.name), check, remoteModels: remote, loadedBefore: (psBefore.models ?? []).map((m) => m.name) });
if (!check.ok || remote.length) {
  report.stopped = 'preflight_failed';
  await finish(1);
}

// GPU 取樣（nvidia-smi 唯讀查詢）
// 加上 nvidia-smi 自己的時間戳（不依賴輸出到達的時間）
gpu = spawn('nvidia-smi', ['--query-gpu=timestamp,utilization.gpu,memory.used', '--format=csv,noheader,nounits', '-lms', '100']);
gpu.stdout.setEncoding('utf8');
let buf = '';
gpu.stdout.on('data', (d) => {
  buf += d;
  const lines = buf.split(/\r?\n/);
  buf = lines.pop();
  for (const l of lines) {
    const [ts, u, m] = l.split(',').map((x) => x.trim());
    const smi = Date.parse(ts.replace(/\//g, '-').replace(' ', 'T'));
    if (Number.isFinite(Number(u))) gpuSamples.push({ t: rel(), smiT: Number.isFinite(smi) ? smi - T0 : null, util: Number(u), memMiB: Number(m) });
  }
});

// ---------- 1. 獨立測試 Hub ----------
tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fairy-h32-real-'));
const results = [];
const adapter = ollamaAdapter(MODEL, { ...(FAKE ? { port: fakeSrv.port } : {}), allow: [MODEL], digest: DIGEST, onResult: (r) => results.push({ t: rel(), ...r }) });
const realAsk = adapter.ask;
adapter.ask = (...a) => {
  report.inferenceCalls++;
  if (report.inferenceCalls > 2) throw new Error('more than 2 inference calls'); // 保險：絕不超過 2 次
  return realAsk(...a);
};
const cloud = { isOwner: () => false, cloudStatus: () => ({}), cloudChat: async () => [403, {}] };
const hub = createHub({ dir: tmpDir, ai: adapter, scheduler: { capacity: 2, timeoutMs: 60_000, waitMs: 60_000 } });
relay = createRelay({ token: FP_TOKEN, mcToken: MC_TOKEN, hub, cloud, ollama: { host: '127.0.0.1', port: 1 } });
await new Promise((r) => relay.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${relay.address().port}`;
const mc = async (method, p, body) => {
  const res = await fetch(base + p, {
    method,
    headers: { authorization: `Bearer ${MC_TOKEN}`, 'x-fairy-source': 'smoke-paper-01', 'x-fairy-actor': ACTOR, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const pet = (await mc('POST', '/api/allay/mc/pet', { name: '測試悅靈' })).json.pet;
await sleep(1500); // GPU 基準
step('baseline', { procs: await ollamaProcs() });

// ---------- 2. 一般請求 ----------
const a0 = Date.now();
const r1 = await mc('POST', '/api/allay/talk', { pet, opId: 'smoke-talk-0001', text: '你好！今天我們要去哪裡冒險？', lang: 'zh_tw', place: '草原' });
const a1 = Date.now();
const m1 = results[0] ?? null;
step('request1', {
  status: r1.status, route: r1.json?.route, wallMs: a1 - a0,
  ollama: m1 && {
    model: m1.model, done_reason: m1.done_reason, keys: m1.keys,
    loadMs: Math.round((m1.load_duration ?? 0) / 1e6), promptMs: Math.round((m1.prompt_eval_duration ?? 0) / 1e6),
    evalMs: Math.round((m1.eval_duration ?? 0) / 1e6), totalMs: Math.round((m1.total_duration ?? 0) / 1e6),
    firstOutputMs: Math.round(((m1.load_duration ?? 0) + (m1.prompt_eval_duration ?? 0)) / 1e6),
    promptTokens: m1.prompt_eval_count, outputTokens: m1.eval_count,
    tokensPerSec: m1.eval_count && m1.eval_duration ? +(m1.eval_count / (m1.eval_duration / 1e9)).toFixed(1) : null,
  },
  intent: r1.json?.intent && { kind: r1.json.intent.kind, emotion: r1.json.intent.emotion, soundPolicy: r1.json.intent.soundPolicy, textChars: [...(r1.json.intent.dialogueText ?? '')].length, text: r1.json.intent.dialogueText },
});
if (r1.status !== 200 || r1.json?.route !== 'LOCAL_OLLAMA' || !m1 || m1.model !== MODEL || m1.keys.some((k) => /remote/i.test(k))) {
  report.stopped = 'request1_unexpected';
  await finish(1);
}
const psLoaded = await getJson('/api/ps');
step('loaded', { ps: (psLoaded.models ?? []).map((m) => ({ name: m.name, digest: m.digest?.slice(0, 12), size_vram: m.size_vram, expires_at: m.expires_at })) });
await sleep(3000); // 閒置
step('idleAfter1', { procs: await ollamaProcs() });

// ---------- 3. 中途取消的請求（Hub 逾時 400 毫秒 → 取消底層請求） ----------
hub.scheduler.timeoutMs = 400;
const before2 = await ollamaProcs();
const c0 = Date.now();
const r2 = await mc('POST', '/api/allay/talk', { pet, opId: 'smoke-talk-0002', text: '請跟我說一個很長很長的冒險故事，從頭到尾慢慢講。', lang: 'zh_tw' });
const c1 = Date.now();
step('request2_cancel', { status: r2.status, route: r2.json?.route, wallMs: c1 - c0, abortAtMs: c1 - T0, hubAborted: hub.scheduler.stats.aborted, responseArrived: results.length > 1 });
// 取消後依序取樣（實際時間以取樣完成時為準）
const cpu = [{ afterAbortMs: -(c1 - c0), procs: before2 }];
for (const target of [0, 1500, 3000, 6000]) {
  const wait = target - (Date.now() - c1);
  if (wait > 0) await sleep(wait);
  cpu.push({ afterAbortMs: Date.now() - c1, procs: await ollamaProcs() });
}
step('afterCancel', { cpu, runningOnHub: hub.scheduler.running !== null, responseArrivedLater: results.length > 1 });
const psAfter = await getJson('/api/ps');
step('psAfter', { ps: (psAfter.models ?? []).map((m) => ({ name: m.name, expires_at: m.expires_at })) });
await sleep(1000);
await finish(0);
