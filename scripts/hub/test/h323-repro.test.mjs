// H3-2.3 重現測試（只看假服務端與排程器，新舊版本都能執行）：
// Astra 的情境——假 Ollama 回 500、每 10 毫秒持續傳送、永不結束；連續 3 次後，錯誤連線必須都已關閉
import assert from 'node:assert/strict';
import test from 'node:test';
import { LOCAL_DIGEST, startFakeOllama } from '../bench/fakeOllama.mjs';
import { ollamaAdapter, Scheduler } from '../localai.mjs';

const ask = (sch) => sch.submit('p1', 'sys', [{ role: 'user', content: 'hi' }], 'RULE');

for (const which of ['tags', 'chat'])
  test(`重現：/api/${which} 回 500 並持續傳輸 ×3 → 排程器沒有工作時，假服務端的錯誤連線也必須都已關閉`, async (t) => {
    const fake = await startFakeOllama();
    t.after(() => fake.close());
    Object.assign(fake.stats, { [`${which}Status`]: 500, errorStream: true });
    const sch = new Scheduler(ollamaAdapter('gemma3:4b', { port: fake.port, allow: ['gemma3:4b'], digest: LOCAL_DIGEST }), { timeoutMs: 5000 });
    for (let i = 0; i < 3; i++) assert.equal((await ask(sch)).route, 'RULES');
    await new Promise((r) => setTimeout(r, 300)); // 給連線關閉的時間（有界）
    assert.deepEqual([sch.running, sch.stats.inFlight], [null, 0], '排程器顯示沒有工作');
    assert.equal(fake.stats.errorOpen, 0, `還開著的錯誤連線：${fake.stats.errorOpen}`);
    assert.equal(fake.stats.errorClosed, 3);
  });
