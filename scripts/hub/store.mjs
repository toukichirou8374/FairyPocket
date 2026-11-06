// Fairy Hub：交易式耐久儲存
// - 一份文件＝一個 JSON 檔（外層帶格式、版本、SHA-256 檢查碼）
// - 寫入：暫存檔 → fsync → 原檔複製為 .prev（診斷用）→ 暫存檔改名為正式檔 → 才更新記憶體快取（才 ACK）
// - 啟動復原（H2.1，fail-closed）：
//   * 正式檔正確 → 使用；殘留的暫存檔是沒有 ACK 的寫入，移到 quarantine/ 保留證據
//   * 只有暫存檔（沒有正式檔、也沒有前一版）→ 第一次建立就中斷、從未 ACK → 移到 quarantine/，當作不存在
//   * 正式檔損壞或不見（但有前一版／暫存檔）→ 視為資料損壞：不自動退回舊版本（避免撤銷過的權限重新開放、
//     已確認的事件或 epoch 靜默回退），整份標記為無法使用、所有檔案複製到 quarantine/ 保留，等人工處理
// - 備份：一致的資料視圖（讀兩次確認沒變，或直接用執行中的快取）＋清單＋跨文件一致性檢查
// - 還原：先完整驗證、拒絕回退（除非明確允許），寫到暫存資料夾再整個替換；中途失敗會復原原資料夾

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
const stamp = (now) => new Date(now).toISOString().replace(/[:.]/g, '-');

export class Store {
  /**
   * @param {string} dir 資料夾
   * @param {{ faults?: object, now?: () => number }} opts faults 是測試用的故障注入
   */
  constructor(dir, opts = {}) {
    this.dir = dir;
    this.faults = opts.faults ?? {};
    this.now = opts.now ?? (() => Date.now());
    this.cache = new Map();
    /** 啟動時的復原報告：failed＝資料損壞、拒絕使用；aborted＝第一次建立就中斷；quarantined＝保留的證據 */
    this.report = { loaded: [], failed: [], aborted: [], quarantined: [] };
    fs.mkdirSync(dir, { recursive: true });
    this.#recover();
  }

  #file(name, kind = '') {
    return path.join(this.dir, `${name}${kind}.json`);
  }

  /** 把檔案複製（或移動）到 quarantine/<name>-<時間>/，保留診斷證據 */
  #quarantine(name, kinds, move) {
    const q = path.join(this.dir, 'quarantine', `${name}-${stamp(this.now())}`);
    fs.mkdirSync(q, { recursive: true });
    for (const k of kinds) {
      const f = this.#file(name, k);
      if (!fs.existsSync(f)) continue;
      const to = path.join(q, path.basename(f));
      if (move) fs.renameSync(f, to);
      else fs.copyFileSync(f, to);
    }
    this.report.quarantined.push(path.relative(this.dir, q));
    return q;
  }

  #recover() {
    const names = new Set();
    for (const f of fs.readdirSync(this.dir)) {
      const m = /^([A-Za-z0-9_-]+?)(\.tmp|\.prev)?\.json$/.exec(f);
      if (m) names.add(m[1]);
    }
    for (const name of names) {
      const has = (k) => fs.existsSync(this.#file(name, k));
      const main = has('') ? unwrap(fs.readFileSync(this.#file(name), 'utf8')) : null;
      if (main) {
        this.cache.set(name, main);
        this.report.loaded.push(name);
        if (has('.tmp')) this.#quarantine(name, ['.tmp'], true); // 沒有 ACK 的寫入
        continue;
      }
      if (!has('') && !has('.prev') && has('.tmp')) {
        // 第一次建立就中斷：從來沒有 ACK 過，可以安全地當作不存在
        this.#quarantine(name, ['.tmp'], true);
        this.report.aborted.push(name);
        continue;
      }
      // 資料損壞：不自動退回前一版；保留原檔（讓這份持續無法使用），並複製一份證據
      this.#quarantine(name, ['', '.tmp', '.prev'], false);
      this.report.failed.push({ name, why: has('') ? 'checksum_or_format' : 'main_missing' });
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
  /** 這份文件在啟動時判定損壞（拒絕使用，也拒絕覆寫，避免當成不存在而重建） */
  isBroken(name) {
    return this.report.failed.some((f) => f.name === name);
  }

  /** 交易式寫入：成功才更新快取；任何失敗丟出 503 STORE_UNAVAILABLE，快取不變 */
  commit(name, body) {
    if (!NAME_RE.test(name)) throw new HubError(400, 'SCHEMA', { where: 'doc.name' });
    if (this.isBroken(name)) throw new HubError(503, 'STORE_UNAVAILABLE');
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
        /* 下次啟動會處理 */
      }
      if (e instanceof HubError) throw e;
      throw new HubError(503, 'STORE_UNAVAILABLE');
    }
    this.cache.set(name, structuredClone(body));
  }
}

// ---------- 跨文件一致性（Hub 的資料配置：hub.json＋pets/<petId>.json） ----------
/** docs：{ 'hub.json': body, 'pets/X.json': body, ... }；不一致丟出 400 BACKUP_INVALID */
export function checkConsistency(docs) {
  const pets = new Set();
  for (const [rel, body] of Object.entries(docs)) {
    const m = /^pets\/([A-Za-z0-9_-]+)\.json$/.exec(rel);
    if (!m) continue;
    if (body?.pet !== m[1]) throw new HubError(400, 'BACKUP_INVALID', { why: 'pet_name_mismatch', rel });
    if (!Number.isInteger(body.rev) || !Number.isInteger(body.epoch)) throw new HubError(400, 'BACKUP_INVALID', { why: 'pet_fields', rel });
    pets.add(m[1]);
  }
  const hub = docs['hub.json'];
  if (hub) {
    for (const c of Object.values(hub.codes ?? {})) if (!pets.has(c.pet)) throw new HubError(400, 'BACKUP_INVALID', { why: 'code_without_pet' });
    for (const v of Object.values(hub.linkIndex ?? {})) if (!pets.has(typeof v === 'string' ? v : v?.pet)) throw new HubError(400, 'BACKUP_INVALID', { why: 'link_without_pet' });
  } else if (pets.size) throw new HubError(400, 'BACKUP_INVALID', { why: 'hub_missing' });
  return pets.size;
}

function listDocs(dir) {
  const out = [];
  for (const sub of ['', 'pets']) {
    const from = path.join(dir, sub);
    if (!fs.existsSync(from)) continue;
    for (const f of fs.readdirSync(from)) if (/^[A-Za-z0-9_-]+\.json$/.test(f) && !/\.(tmp|prev)\.json$/.test(f)) out.push(sub ? `${sub}/${f}` : f);
  }
  return out.sort();
}

function writeSnapshot(files, destRoot, now, allowEmpty) {
  const rels = Object.keys(files);
  if (!rels.length && !allowEmpty) throw new HubError(400, 'BACKUP_EMPTY');
  const docs = {};
  for (const rel of rels) docs[rel] = unwrap(files[rel]);
  const petCount = checkConsistency(docs);
  const snap = path.join(destRoot, `fairy-hub-backup-${stamp(now)}`);
  if (fs.existsSync(snap)) throw new HubError(409, 'BACKUP_EXISTS');
  fs.mkdirSync(path.join(snap, 'pets'), { recursive: true });
  const hashes = {};
  for (const rel of rels) {
    fs.writeFileSync(path.join(snap, rel), files[rel]);
    hashes[rel] = sha256(files[rel]);
  }
  fs.writeFileSync(path.join(snap, 'manifest.json'), JSON.stringify({ format: 'fairy-hub-backup', hubSchema: HUB_SCHEMA, createdAt: now, petCount, allowEmpty: !!allowEmpty, files: hashes }, null, 1));
  return snap;
}

/**
 * 從資料夾建立快照（服務停止時用）。為了一致的視圖：整組讀兩次，內容完全相同才採用（最多重試 3 次）。
 * 來源不存在、有損壞的文件、意外的空資料、跨文件不一致 → 拒絕。
 */
export function backup(dir, destRoot, now = Date.now(), opts = {}) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new HubError(400, 'BACKUP_SOURCE_MISSING');
  const readAll = () => Object.fromEntries(listDocs(dir).map((rel) => [rel, fs.readFileSync(path.join(dir, rel), 'utf8')]));
  for (let attempt = 0; attempt < 3; attempt++) {
    const a = readAll();
    opts.faults?.betweenReads?.(attempt);
    const b = readAll();
    if (canonical(Object.keys(a)) !== canonical(Object.keys(b)) || Object.keys(a).some((k) => a[k] !== b[k])) continue;
    for (const [rel, raw] of Object.entries(a)) if (!unwrap(raw)) throw new HubError(500, 'BACKUP_SOURCE_CORRUPT', { rel });
    return writeSnapshot(a, destRoot, now, opts.allowEmpty);
  }
  throw new HubError(409, 'BACKUP_UNSTABLE');
}

/** 從執行中的 Hub 快取建立快照（同步完成，所以是同一個時間點的一致視圖） */
export function backupFromStores(stores, destRoot, now = Date.now(), opts = {}) {
  const files = {};
  for (const [prefix, store] of stores) for (const name of store.names()) files[`${prefix}${name}.json`] = wrap(store.get(name));
  return writeSnapshot(files, destRoot, now, opts.allowEmpty);
}

/** 驗證快照：清單、每個檔案的 SHA-256、每份文件的檢查碼、跨文件一致性；回傳 { files, docs } */
export function verifyBackup(snap) {
  if (!fs.existsSync(snap)) throw new HubError(400, 'BACKUP_INVALID', { why: 'missing_snapshot' });
  let man;
  try {
    man = JSON.parse(fs.readFileSync(path.join(snap, 'manifest.json'), 'utf8'));
  } catch {
    throw new HubError(400, 'BACKUP_INVALID', { why: 'manifest' });
  }
  if (man?.format !== 'fairy-hub-backup' || man.hubSchema !== HUB_SCHEMA || typeof man.files !== 'object' || man.files === null) throw new HubError(400, 'BACKUP_INVALID', { why: 'manifest' });
  const rels = Object.keys(man.files);
  if (!rels.length && !man.allowEmpty) throw new HubError(400, 'BACKUP_EMPTY');
  const docs = {};
  for (const rel of rels) {
    if (!/^(pets\/)?[A-Za-z0-9_-]+\.json$/.test(rel)) throw new HubError(400, 'BACKUP_INVALID', { why: 'path', rel });
    let raw;
    try {
      raw = fs.readFileSync(path.join(snap, rel), 'utf8');
    } catch {
      throw new HubError(400, 'BACKUP_INVALID', { why: 'missing', rel });
    }
    const body = unwrap(raw);
    if (sha256(raw) !== man.files[rel] || !body) throw new HubError(400, 'BACKUP_INVALID', { why: 'checksum', rel });
    docs[rel] = body;
  }
  // 清單外多出來的文件（可能是不完整或被混進去的資料）
  for (const rel of listDocs(snap)) if (rel !== 'manifest.json' && !(rel in man.files)) throw new HubError(400, 'BACKUP_INVALID', { why: 'unlisted_file', rel });
  const petCount = checkConsistency(docs);
  if (typeof man.petCount === 'number' && man.petCount !== petCount) throw new HubError(400, 'BACKUP_INVALID', { why: 'pet_count' });
  return { files: rels, docs };
}

/**
 * 還原（服務必須先停止）：
 * 1. 完整驗證快照
 * 2. 拒絕回退：目前資料裡任何一隻悅靈的 rev／epoch 比快照新，或快照裡沒有 → ROLLBACK_REFUSED（opts.allowRollback 才放行）
 * 3. 寫到暫存資料夾；中途失敗刪掉暫存、原資料完全不動
 * 4. 原資料夾改名保留 → 暫存資料夾改名成正式；第二步失敗就把原資料夾改回來
 */
export function restore(snap, dir, now = Date.now(), opts = {}) {
  const { files, docs } = verifyBackup(snap);
  const f = opts.faults ?? {};
  if (fs.existsSync(dir) && !opts.allowRollback) {
    for (const rel of listDocs(dir).filter((r) => r.startsWith('pets/'))) {
      const cur = unwrap(fs.readFileSync(path.join(dir, rel), 'utf8'));
      if (!cur) continue; // 目前已損壞的文件不比較（還原正是要處理它）
      const old = docs[rel];
      if (!old || old.rev < cur.rev || old.epoch < cur.epoch) throw new HubError(409, 'ROLLBACK_REFUSED', { rel });
    }
  }
  const staging = `${dir}.restore-${now}`;
  try {
    fs.mkdirSync(path.join(staging, 'pets'), { recursive: true });
    files.forEach((rel, i) => {
      f.duringCopy?.(i);
      fs.copyFileSync(path.join(snap, rel), path.join(staging, rel));
      fsyncFile(path.join(staging, rel));
    });
  } catch (e) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw new HubError(500, 'RESTORE_FAILED', { why: 'copy', cause: e.message });
  }
  const old = `${dir}.old-${now}`;
  const hadDir = fs.existsSync(dir);
  if (hadDir) fs.renameSync(dir, old);
  try {
    f.beforeSwap?.();
    fs.renameSync(staging, dir);
  } catch (e) {
    if (hadDir && !fs.existsSync(dir)) fs.renameSync(old, dir);
    fs.rmSync(staging, { recursive: true, force: true });
    throw new HubError(500, 'RESTORE_FAILED', { why: 'swap', cause: e.message });
  }
  return { restored: files.length, previous: hadDir ? old : null };
}

/**
 * 人工處理損壞的文件（服務必須先停止）：明確指定用前一版或暫存檔，並寫下處理紀錄。
 * 這是管理者的決定，Hub 不會自動做。
 */
export function recoverDoc(dir, name, from, now = Date.now()) {
  if (!NAME_RE.test(name) || (from !== 'prev' && from !== 'tmp')) throw new HubError(400, 'SCHEMA');
  const src = path.join(dir, `${name}.${from}.json`);
  const body = fs.existsSync(src) ? unwrap(fs.readFileSync(src, 'utf8')) : null;
  if (!body) throw new HubError(400, 'RECOVER_SOURCE_INVALID');
  const main = path.join(dir, `${name}.json`);
  const q = path.join(dir, 'quarantine', `${name}-manual-${stamp(now)}`);
  fs.mkdirSync(q, { recursive: true });
  if (fs.existsSync(main)) fs.copyFileSync(main, path.join(q, `${name}.json`));
  fs.writeFileSync(path.join(q, 'RECOVERY.txt'), `manual recovery of ${name} from ${from} at ${new Date(now).toISOString()} (rev ${body.rev}, epoch ${body.epoch})\n`);
  fs.writeFileSync(`${main}.restore`, wrap(body));
  fsyncFile(`${main}.restore`);
  fs.renameSync(`${main}.restore`, main);
  return { name, from, rev: body.rev, epoch: body.epoch, evidence: q };
}
