// 生命模式的觀察紀錄（手機開發者區打開「生命模式觀察紀錄」時才會送來）：
// 存在這台電腦的 private/life-logs/日期.jsonl（private/ 不會上傳），讓開發時看得到悅靈實際怎麼想、怎麼做。
// 每天最多 20MB；只收文字紀錄，不收圖片或聲音。

import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join(path.resolve(import.meta.dirname, '..'), 'private', 'life-logs');
const DAY_CAP = 20 * 1024 * 1024;

const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** POST /api/lifelog {entries:[{t,k,d}]} → [狀態碼, 物件] */
export function writeLifeLog(body) {
  const entries = Array.isArray(body?.entries) ? body.entries.slice(0, 500) : null;
  if (!entries) return [400, { error: 'bad_request' }];
  fs.mkdirSync(DIR, { recursive: true });
  const file = path.join(DIR, `${today()}.jsonl`);
  let size = 0;
  try {
    size = fs.statSync(file).size;
  } catch {
    /* 今天第一筆 */
  }
  if (size > DAY_CAP) return [413, { error: 'full' }];
  const lines = entries
    .filter((e) => e && typeof e.k === 'string')
    .map((e) => JSON.stringify({ t: String(e.t ?? ''), k: e.k.slice(0, 20), d: e.d }))
    .join('\n');
  if (lines) fs.appendFileSync(file, `${lines}\n`);
  return [200, { ok: true }];
}
