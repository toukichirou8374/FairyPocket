// Fairy Hub：交易式耐久儲存
// - 一份文件＝一個 JSON 檔（外層帶格式、版本、SHA-256 檢查碼）
// - 寫入：暫存檔 → fsync → 原檔改名為 .prev → 暫存檔改名為正式檔 → 才更新記憶體快取（才 ACK）
// - 啟動復原：正式檔 → 暫存檔 → 前一版，第一個檢查碼正確的就用；都壞了就拒絕載入（不會用空資料蓋掉）
// - 備份：快照＋清單（每個檔案的 SHA-256）；還原先驗證，再整個資料夾替換

import fs from 'node:fs';
import path from 'node:path';
import { canonical, HUB_SCHEMA, HubError, sha256 } from './schema.mjs';

const FORMAT = 'fairy-hub-doc';
const NAME_RE = /^[A-Za-z0-9_-]{1,80}$/;

export function wrap(body) {
  const json = canonical(body);
  return JSON.stringify({ format: FORMAT, hubSchema: HUB_SCHEMA, sha256: sha256(json), body: JSON.parse(json) });
}
/** 檢查外層與檢查碼；不對回傳 null */
export function unwrap(raw) {
  try {
    const env = JSON.parse(raw);
    if (env?.format !== FORMAT || env.hubSchema !== HUB_SCHEMA || typeof env.sha256 !== 'string') return null;
    return sha256(canonical(env.body)) === env.sha256 ? env.body : null;
  } catch {
    return null;
  }
}

function fsyncFile(p) {
  const fd = fs.openSync(p, 'r+');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
function fsyncDir(dir) {
  // Windows 不支援對資料夾 fsync；其他系統盡量做
  try {
    const fd = fs.openSync(dir, 'r');
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    /* 不支援就略過 */
  }
}

export class Store {
  /**
   * @param {string} dir 資料夾
   * @param {{ faults?: { beforeWrite?: (name:string)=>void, afterTmp?: (name:string)=>void } }} opts 測試用的故障注入
   */
  constructor(dir, opts = {}) {
    this.dir = dir;
    this.faults = opts.faults ?? {};
    this.cache = new Map();
    /** 啟動時的復原報告 */
    this.report = { loaded: [], recovered: [], failed: [], cleaned: [] };
    fs.mkdirSync(dir, { recursive: true });
    this.#recover();
  }

  #file(name, kind = '') {
    return path.join(this.dir, `${name}${kind}.json`);
  }

  #recover() {
    const names = new Set();
    for (const f of fs.readdirSync(this.dir)) {
      const m = /^([A-Za-z0-9_-]+?)(\.tmp|\.prev)?\.json$/.exec(f);
      if (m) names.add(m[1]);
    }
    for (const name of names) {
      const read = (kind) => {
        try {
          return unwrap(fs.readFileSync(this.#file(name, kind), 'utf8'));
        } catch {
          return null;
        }
      };
      const main = read('');
      if (main) {
        this.cache.set(name, main);
        this.report.loaded.push(name);
      } else {
        // 正式檔壞了或不見了：先試暫存檔（寫到一半就當機），再試前一版
        const tmp = read('.tmp');
        const prev = read('.prev');
        const pick = tmp ?? prev;
        if (pick) {
          fs.writeFileSync(this.#file(name, '.restore'), wrap(pick));
          fsyncFile(this.#file(name, '.restore'));
          fs.renameSync(this.#file(name, '.restore'), this.#file(name));
          this.cache.set(name, pick);
          this.report.recovered.push({ name, from: tmp ? 'tmp' : 'prev' });
        } else {
          this.report.failed.push(name);
        }
      }
      if (fs.existsSync(this.#file(name, '.tmp'))) {
        fs.rmSync(this.#file(name, '.tmp'));
        this.report.cleaned.push(name);
      }
    }
    fsyncDir(this.dir);
  }

  get(name) {
    const v = this.cache.get(name);
    return v === undefined ? null : structuredClone(v);
  }
  has(name) {
    return this.cache.has(name);
  }
  names() {
    return [...this.cache.keys()];
  }
  /** 這份文件在啟動時無法復原（拒絕使用，避免當成不存在而重建） */
  isBroken(name) {
    return this.report.failed.includes(name);
  }

  /** 交易式寫入：成功才更新快取；任何失敗丟出 503 STORE_UNAVAILABLE，快取不變 */
  commit(name, body) {
    if (!NAME_RE.test(name)) throw new HubError(400, 'SCHEMA', { where: 'doc.name' });
    const tmp = this.#file(name, '.tmp');
    const main = this.#file(name);
    try {
      this.faults.beforeWrite?.(name);
      fs.writeFileSync(tmp, wrap(body));
      fsyncFile(tmp);
      this.faults.afterTmp?.(name);
      if (fs.existsSync(main)) fs.copyFileSync(main, this.#file(name, '.prev'));
      fs.renameSync(tmp, main);
      fsyncDir(this.dir);
    } catch (e) {
      try {
        if (fs.existsSync(tmp) && !this.faults.keepTmp) fs.rmSync(tmp);
      } catch {
        /* 下次啟動會清掉 */
      }
      if (e instanceof HubError) throw e;
      throw new HubError(503, 'STORE_UNAVAILABLE');
    }
    this.cache.set(name, structuredClone(body));
  }
}

// ---------- 備份與還原 ----------
/** 建立快照：只複製正式檔，並寫清單（SHA-256）；回傳快照資料夾 */
export function backup(dir, destRoot, now = Date.now()) {
  const snap = path.join(destRoot, `fairy-hub-backup-${new Date(now).toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(snap, { recursive: true });
  const files = {};
  for (const sub of ['', 'pets']) {
    const from = path.join(dir, sub);
    if (!fs.existsSync(from)) continue;
    for (const f of fs.readdirSync(from)) {
      if (!/^[A-Za-z0-9_-]+\.json$/.test(f) || /\.(tmp|prev)\.json$/.test(f)) continue;
      const raw = fs.readFileSync(path.join(from, f), 'utf8');
      if (!unwrap(raw)) throw new HubError(500, 'BACKUP_SOURCE_CORRUPT', { file: path.join(sub, f) });
      const rel = sub ? `${sub}/${f}` : f;
      fs.mkdirSync(path.join(snap, sub), { recursive: true });
      fs.writeFileSync(path.join(snap, rel), raw);
      files[rel] = sha256(raw);
    }
  }
  fs.writeFileSync(path.join(snap, 'manifest.json'), JSON.stringify({ format: 'fairy-hub-backup', hubSchema: HUB_SCHEMA, createdAt: now, files }, null, 1));
  return snap;
}

/** 驗證快照：清單、每個檔案的 SHA-256、每份文件的檢查碼；回傳檔案清單 */
export function verifyBackup(snap) {
  let man;
  try {
    man = JSON.parse(fs.readFileSync(path.join(snap, 'manifest.json'), 'utf8'));
  } catch {
    throw new HubError(400, 'BACKUP_INVALID', { why: 'manifest' });
  }
  if (man?.format !== 'fairy-hub-backup' || man.hubSchema !== HUB_SCHEMA || typeof man.files !== 'object') throw new HubError(400, 'BACKUP_INVALID', { why: 'manifest' });
  for (const [rel, hash] of Object.entries(man.files)) {
    if (!/^(pets\/)?[A-Za-z0-9_-]+\.json$/.test(rel)) throw new HubError(400, 'BACKUP_INVALID', { why: 'path', rel });
    let raw;
    try {
      raw = fs.readFileSync(path.join(snap, rel), 'utf8');
    } catch {
      throw new HubError(400, 'BACKUP_INVALID', { why: 'missing', rel });
    }
    if (sha256(raw) !== hash || !unwrap(raw)) throw new HubError(400, 'BACKUP_INVALID', { why: 'checksum', rel });
  }
  return Object.keys(man.files);
}

/** 還原：先驗證，寫到暫存資料夾，再把原資料夾改名保留、暫存資料夾改名成正式資料夾 */
export function restore(snap, dir, now = Date.now()) {
  const files = verifyBackup(snap);
  const staging = `${dir}.restore-${now}`;
  fs.mkdirSync(path.join(staging, 'pets'), { recursive: true });
  for (const rel of files) {
    fs.copyFileSync(path.join(snap, rel), path.join(staging, rel));
    fsyncFile(path.join(staging, rel));
  }
  const old = `${dir}.old-${now}`;
  if (fs.existsSync(dir)) fs.renameSync(dir, old);
  fs.renameSync(staging, dir);
  return { restored: files.length, previous: fs.existsSync(old) ? old : null };
}
