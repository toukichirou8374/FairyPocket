// FairyPocket ↔ Fairy Hub 同步適配器（H3-1.1：最小、隔離；尚未接進 App 畫面）
//
// 原則（與 Hub v1 契約一致）：
// - 只送「事件」，不送整份快照（VITALS_SYNC 停用中，這裡也沒有任何送數值快照的方法）
// - 每個本機動作先寫進「待送佇列」（存在本機），送成功（APPLIED 或 DUPLICATE）才移除 → 斷線、重啟都不會遺失或重複
// - opId 由穩定的裝置來源 ID＋遞增序號組成，重送時不變 → Hub 去重，不會重複計算
// - revision 衝突：重新讀取後，用「同樣的 opId」把同一批事件重送到新的版本上（本機事件都是增量或附加，可以安全地重新套用）
// - 控制權：要送會改數值的事件時才取得；Minecraft 正在控制時「不搶」，數值事件留在佇列等待（只有主人明確按「叫回手機」才接管）
// - 交接：從 Minecraft 手上接回控制權時，採用 Hub 的數值（Minecraft 期間的變化），之後手機繼續當生活模擬的權威
// - 防倒退：Hub 的 revision 比已確認的還小（例如還原了舊備份）→ 停止同步、不採用任何遠端數值、保留佇列
//
// H3-1.1（Astra 驗收的三項修補）：
// - 本機同步資料損壞或結構異常：停止同步，不建立新的來源 ID、不覆寫原始內容、不清空佇列（原始內容就是證據）
// - 首次登記：先把「登記快照＋分界序號」存進本機；快照已包含的動作不再送，快照之後的動作照常送
// - 每個成功回應（登記、取得控制權、送出事件、讀取）帶回的 revision／epoch，與佇列變更在同一次本機寫入保存；
//   本機寫入失敗不算同步成功
//
// H3-1.2：首次登記帶一個持久保存的登記識別碼（regId）。Hub 保存「來源 ID＋識別碼雜湊」；
// 重試時由 Hub 核對，確認是同一次登記才回 200 DUPLICATE。收到 409 EXISTS（別的裝置／來源已建立，
// 或舊資料沒有可靠的登記紀錄）一律停止：不刪事件、不重送、不改手機的數值與記憶、不回報 ok。
// 識別碼只用來確認登記冪等性，不是裝置身分認證。

import type { PetState } from '../game/state';

export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export interface HttpResult {
  status: number;
  json: any;
}
/** 傳輸層：連不上時丟出例外（視為離線） */
export type Transport = (method: 'GET' | 'POST', path: string, body?: unknown) => Promise<HttpResult>;

export type NumericType = 'FED' | 'PETTED' | 'PLAYED';
export type PlainType = 'RENAME' | 'MEMORY_ADD' | 'MEMORY_REMOVE' | 'DIALOGUE_ADD';
const NUMERIC: readonly string[] = ['FED', 'PETTED', 'PLAYED'];
const TYPES: readonly string[] = ['FED', 'PETTED', 'PLAYED', 'RENAME', 'MEMORY_ADD', 'MEMORY_REMOVE', 'DIALOGUE_ADD'];
/** 登記快照會包含效果的動作（記憶與對話不在快照裡，登記後仍要送） */
const IN_SNAPSHOT: readonly string[] = ['FED', 'PETTED', 'PLAYED', 'RENAME'];

export interface QueuedEvent {
  opId: string;
  /** 本機遞增序號（用來判斷是在登記快照之前還是之後） */
  seq: number;
  type: NumericType | PlainType;
  at: number;
  payload: Record<string, unknown>;
}

/** 從 Hub 採用的資料（由 App 或測試套用到本機的 PetState） */
export interface RemoteApply {
  rev: number;
  name?: string;
  affection?: number;
  stats?: PetState['stats'];
  /** 只有從 Minecraft 接回控制權時才會有 */
  vitals?: { health: number; hunger: number; energy: number; mood: number; asleep: boolean };
  /** Minecraft 加的共享記憶（分開保存，不會擠掉手機自己的記憶） */
  sharedMemories?: string[];
}

export type SyncStatus =
  | 'ok' | 'offline' | 'waitingControl' | 'hubRollback' | 'hubMissing' | 'unavailable' | 'capacity' | 'busy' | 'error'
  /** 本機同步資料損壞或結構異常：已停止，原始內容保留不動 */
  | 'localCorrupt'
  /** 本機寫入失敗：這次不算完成 */
  | 'localSaveFailed'
  /** 同一個 petId 已由別的裝置／來源登記（Hub 證實不是這次登記）：停止，保留一切 */
  | 'registrationConflict'
  /** Hub 上已有這隻，但沒有可靠的登記紀錄、無法證明來源：停止，保留一切 */
  | 'registrationUnverified';
export interface SyncResult {
  status: SyncStatus;
  sent: number;
  pending: number;
  rev?: number;
  detail?: string;
}

interface Persisted {
  v: 2;
  sourceId: string;
  petId: string | null;
  registered: boolean;
  seq: number;
  outbox: QueuedEvent[];
  /** 送不出去、也不能重送的事件（例如同 ID 不同內容），保留給人檢查 */
  dead: (QueuedEvent & { why: string })[];
  /** 已確認的最大 Hub 版本（只增不減，用來發現倒退） */
  seenRev: number;
  epoch: number;
  /** 已同步的本機記憶：文字 → memoryId */
  syncedNotes: Record<string, string>;
  /** 進行中的取得控制權操作（重送時沿用同一個 opId） */
  claimOpId: string | null;
  /** 首次登記：送出的快照、分界序號（序號 ≤ boundarySeq 的 FED／PETTED／PLAYED／RENAME 已包含在快照裡）、登記識別碼 */
  reg: { snapshot: PetState; boundarySeq: number; regId: string } | null;
}

/** Hub 回傳的悅靈狀態（手機看到的完整內容；只列出這裡用到的欄位） */
interface HubState {
  rev: number;
  epoch: number;
  controller: { role: string; source: string } | null;
  /** 上一個控制者（H3-1 的 Hub 才有） */
  lastController?: { role: string } | null;
  profile?: { name: string };
  state?: { health: number; hunger: number; energy: number; mood: number; affection: number; asleep: boolean };
  stats?: PetState['stats'];
  memories?: { text: string; src: string }[];
}

export const SYNC_KEY = 'fairypocket.hubsync.v1';
const BATCH = 50;

/** 本機寫入失敗 */
class LocalSaveError extends Error {}

/** 文字的固定雜湊（FNV-1a，兩種起始值，共 16 個十六進位字）；同一句記憶永遠得到同一個 memoryId */
export function noteId(text: string): string {
  const h = (seed: number) => {
    let x = seed >>> 0;
    for (const ch of text) {
      x ^= ch.codePointAt(0)!;
      x = Math.imul(x, 0x01000193) >>> 0;
    }
    return x.toString(16).padStart(8, '0');
  };
  return `mem-fp-${h(0x811c9dc5)}${h(0x2b4f9a1d)}`;
}

function newRegId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return `reg-${[...b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

function newSourceId(): string {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return `pocket-${[...b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isInt = (v: unknown, min = 0): v is number => Number.isInteger(v) && (v as number) >= min;

/** 檢查本機同步資料的結構；回傳問題描述，或 null（正常）。不嘗試修補。 */
export function checkPersisted(v: unknown): string | null {
  if (!isObj(v)) return 'not_object';
  if (v.v !== 2) return 'version';
  if (typeof v.sourceId !== 'string' || !/^pocket-[0-9a-f]{16}$/.test(v.sourceId)) return 'sourceId';
  if (v.petId !== null && (typeof v.petId !== 'string' || !/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(v.petId))) return 'petId';
  if (typeof v.registered !== 'boolean' || (v.registered && v.petId === null)) return 'registered';
  if (!isInt(v.seq)) return 'seq';
  if (!Array.isArray(v.outbox)) return 'outbox';
  const ids = new Set<string>();
  for (const e of v.outbox as unknown[]) {
    if (!isObj(e)) return 'outbox_item';
    if (typeof e.opId !== 'string' || !/^[A-Za-z0-9_.-]{8,80}$/.test(e.opId) || ids.has(e.opId)) return 'outbox_opId';
    ids.add(e.opId);
    if (!isInt(e.seq, 1) || (e.seq as number) > (v.seq as number)) return 'outbox_seq';
    if (typeof e.type !== 'string' || !TYPES.includes(e.type)) return 'outbox_type';
    if (typeof e.at !== 'number' || !Number.isFinite(e.at)) return 'outbox_at';
    if (!isObj(e.payload)) return 'outbox_payload';
  }
  if (!Array.isArray(v.dead)) return 'dead';
  if (!isInt(v.seenRev) || !isInt(v.epoch)) return 'rev_epoch';
  if (!isObj(v.syncedNotes) || Object.values(v.syncedNotes).some((x) => typeof x !== 'string')) return 'syncedNotes';
  if (v.claimOpId !== null && typeof v.claimOpId !== 'string') return 'claimOpId';
  if (v.reg !== null) {
    if (!isObj(v.reg) || !isObj(v.reg.snapshot) || typeof v.reg.snapshot.id !== 'string' || !isInt(v.reg.boundarySeq) || (v.reg.boundarySeq as number) > (v.seq as number)) return 'reg';
    if (typeof v.reg.regId !== 'string' || !/^reg-[0-9a-f]{32}$/.test(v.reg.regId)) return 'reg';
    if (v.registered) return 'reg';
  }
  return null;
}

/** 正式連線用：帶通行碼與來源 ID 的 fetch（測試注入自己的傳輸層） */
export function httpTransport(baseUrl: string, token: string, sourceId: string, fetchImpl: typeof fetch = fetch): Transport {
  const base = baseUrl.replace(/\/+$/, '');
  return async (method, path, body) => {
    const res = await fetchImpl(base + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'X-Fairy-Source': sourceId, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      /* 沒有內容 */
    }
    return { status: res.status, json };
  };
}

export interface PocketSyncOptions {
  storage: KV;
  /** 傳輸層：給 sourceId，回傳 Transport（正式用 httpTransport） */
  transport: (sourceId: string) => Transport;
  getPet: () => PetState;
  /** 目前本機記得的事（brain 的 notes） */
  getNotes: () => string[];
  applyRemote: (r: RemoteApply) => void;
  now?: () => number;
}

export class PocketSync {
  /** null＝本機同步資料損壞（已停止，原始內容保留不動） */
  private p: Persisted | null = null;
  private corrupt: string | null = null;
  private busy = false;
  private readonly send: Transport | null = null;
  private readonly now: () => number;

  constructor(private readonly o: PocketSyncOptions) {
    this.now = o.now ?? (() => Date.now());
    this.load();
    if (this.p) this.send = o.transport(this.p.sourceId);
  }

  // ---------- 本機狀態 ----------
  /** 尚未建立 → 建立新的；已存在但損壞或結構異常 → 停止（不覆寫、不建立新來源 ID） */
  private load(): void {
    let raw: string | null;
    try {
      raw = this.o.storage.getItem(SYNC_KEY);
    } catch {
      this.corrupt = 'storage_unreadable';
      return;
    }
    if (raw === null) {
      const fresh: Persisted = { v: 2, sourceId: newSourceId(), petId: null, registered: false, seq: 0, outbox: [], dead: [], seenRev: 0, epoch: 0, syncedNotes: {}, claimOpId: null, reg: null };
      try {
        this.o.storage.setItem(SYNC_KEY, JSON.stringify(fresh));
        this.p = fresh;
      } catch {
        this.corrupt = 'storage_unwritable';
      }
      return;
    }
    let v: unknown;
    try {
      v = JSON.parse(raw);
    } catch {
      this.corrupt = 'parse';
      return;
    }
    const why = checkPersisted(v);
    if (why) this.corrupt = why;
    else this.p = v as Persisted;
  }

  /** 在複本上修改，寫入本機成功後才換上（失敗丟出 LocalSaveError，記憶體也維持原狀） */
  private commit(mut: (d: Persisted) => void): void {
    const d = structuredClone(this.p!);
    mut(d);
    try {
      this.o.storage.setItem(SYNC_KEY, JSON.stringify(d));
    } catch {
      throw new LocalSaveError('local save failed');
    }
    this.p = d;
  }

  /** 給 UI／測試看的狀態 */
  info() {
    const p = this.p;
    if (!p) return { corrupt: this.corrupt, sourceId: null, petId: null, registered: false, pending: null, dead: null, seenRev: null, epoch: null, outbox: [] as QueuedEvent[] };
    return { corrupt: null, sourceId: p.sourceId, petId: p.petId, registered: p.registered, pending: p.outbox.length, dead: p.dead.length, seenRev: p.seenRev, epoch: p.epoch, outbox: p.outbox.map((e) => ({ ...e })) };
  }

  // ---------- 記下本機動作（App 在原本的 feed／pet／play／改名「之後」呼叫） ----------
  /** 回傳 false：本機同步資料損壞或寫入失敗，這個動作沒有記進佇列 */
  private queue(items: { type: QueuedEvent['type']; payload: (opId: string) => Record<string, unknown> }[], extra?: (d: Persisted) => void): boolean {
    if (!this.p) return false;
    try {
      this.commit((d) => {
        for (const it of items) {
          d.seq++;
          const opId = `fp-${d.sourceId.slice(-8)}-${d.seq}`;
          d.outbox.push({ opId, seq: d.seq, type: it.type, at: this.now(), payload: it.payload(opId) });
        }
        extra?.(d);
      });
      return true;
    } catch {
      return false;
    }
  }
  recordFed(food: string): boolean {
    return this.queue([{ type: 'FED', payload: () => ({ food }) }]);
  }
  recordPetted(): boolean {
    return this.queue([{ type: 'PETTED', payload: () => ({}) }]);
  }
  recordPlayed(): boolean {
    return this.queue([{ type: 'PLAYED', payload: () => ({}) }]);
  }
  recordRename(name: string): boolean {
    return this.queue([{ type: 'RENAME', payload: () => ({ name }) }]);
  }
  recordDialogue(who: 'user' | 'allay', name: string, text: string): boolean {
    return this.queue([{ type: 'DIALOGUE_ADD', payload: (opId) => ({ messageId: `msg-${opId}`, who, name, text: text.slice(0, 200) }) }]);
  }
  /** 比對本機記憶與已同步的記憶，產生新增／刪除事件（同一句記憶永遠是同一個 memoryId） */
  syncNotes(): boolean {
    if (!this.p) return false;
    const notes = new Set(this.o.getNotes().map((n) => n.trim()).filter(Boolean));
    const items: { type: QueuedEvent['type']; payload: () => Record<string, unknown> }[] = [];
    const add: Record<string, string> = {};
    const remove: string[] = [];
    for (const text of notes) if (!this.p.syncedNotes[text]) {
      const memoryId = noteId(text);
      items.push({ type: 'MEMORY_ADD', payload: () => ({ memoryId, text: [...text].slice(0, 60).join(''), visibility: 'private' }) });
      add[text] = memoryId;
    }
    for (const [text, memoryId] of Object.entries(this.p.syncedNotes)) if (!notes.has(text)) {
      items.push({ type: 'MEMORY_REMOVE', payload: () => ({ memoryId }) });
      remove.push(text);
    }
    if (!items.length) return true;
    return this.queue(items, (d) => {
      Object.assign(d.syncedNotes, add);
      for (const t of remove) delete d.syncedNotes[t];
    });
  }

  // ---------- 同步 ----------
  /** 同步一次：登記 → 讀取 → （必要時取得控制權）→ 送出佇列 → 採用遠端資料 */
  async sync(opts: { takeover?: boolean } = {}): Promise<SyncResult> {
    if (!this.p || !this.send) return { status: 'localCorrupt', sent: 0, pending: 0, detail: this.corrupt ?? undefined };
    if (this.busy) return { status: 'busy', sent: 0, pending: this.p.outbox.length };
    this.busy = true;
    const send = this.send;
    let sent = 0;
    const done = (status: SyncStatus, detail?: string): SyncResult => ({ status, sent, pending: this.p!.outbox.length, rev: this.p!.seenRev, detail });
    try {
      if (!this.p.registered) {
        // 首次登記：快照與分界序號先存進本機（重試、回應遺失、App 重啟都用同一份）
        if (!this.p.reg) this.commit((d) => (d.reg = { snapshot: toPocketState(this.o.getPet()), boundarySeq: d.seq, regId: newRegId() }));
        const reg = this.p.reg!;
        const r = await send('POST', '/api/allay/pet/register', { petState: reg.snapshot, registration: { regId: reg.regId } });
        // 201：這次登記成功；200 DUPLICATE：Hub 核對過，是這台裝置先前完成的同一次登記（回應遺失後的重試）
        const ours = r.status === 201 || (r.status === 200 && r.json?.status === 'DUPLICATE');
        if (!ours) {
          if (r.status === 409 && r.json?.error === 'EXISTS')
            // 別的裝置／來源建立的，或無法證明來源：不當成登記成功；快照、來源 ID、事件 ID、佇列全部保留
            return done(r.json?.registration === 'other' ? 'registrationConflict' : 'registrationUnverified');
          return done(r.status >= 500 ? 'unavailable' : 'error', `register ${r.status} ${r.json?.error ?? ''}`);
        }
        this.commit((d) => {
          d.registered = true;
          d.petId = reg.snapshot.id;
          // 快照已包含的動作不再送；快照之後新增的動作（序號較大）保留
          d.outbox = d.outbox.filter((e) => !(IN_SNAPSHOT.includes(e.type) && e.seq <= reg.boundarySeq));
          d.seenRev = Math.max(d.seenRev, r.json.rev);
          d.epoch = Math.max(d.epoch, r.json.epoch);
          d.reg = null;
        });
      }
      const petId = this.p.petId!;
      let st = await this.read(petId);
      if (typeof st === 'string') return done(st);
      let handoverFromMc = false;
      let singleMode = false;
      const maxRounds = 8 + 2 * Math.ceil(this.p.outbox.length / BATCH);
      for (let attempt = 0; attempt < maxRounds && this.p.outbox.length; attempt++) {
        const ctl = st.controller;
        const mine = !!ctl && ctl.role === 'fp' && ctl.source === this.p.sourceId;
        const needCtl = this.p.outbox.some((e) => NUMERIC.includes(e.type));
        let batch: QueuedEvent[];
        if (needCtl && !mine) {
          if (ctl?.role === 'mc' && !opts.takeover) {
            // Minecraft 正在控制：不搶。先送不改數值的事件，數值事件留著等
            batch = this.p.outbox.filter((e) => !NUMERIC.includes(e.type));
            if (!batch.length) {
              this.adopt(st, false);
              return done('waitingControl');
            }
          } else {
            const claimed = await this.claim(petId, st.rev);
            if (claimed === 'conflict') {
              const again = await this.read(petId);
              if (typeof again === 'string') return done(again);
              st = again;
              continue;
            }
            if (claimed !== 'ok') return done(claimed);
            // 從 Minecraft 手上接回（正在控制，或剛放開）→ 採用 Minecraft 期間的數值
            handoverFromMc ||= ctl?.role === 'mc' || (!ctl && st.lastController?.role === 'mc');
            const again = await this.read(petId);
            if (typeof again === 'string') return done(again);
            st = again;
            continue;
          }
        } else batch = this.p.outbox;
        batch = batch.slice(0, singleMode ? 1 : BATCH);
        const r = await send('POST', '/api/allay/events', {
          pet: petId,
          baseRevision: st.rev,
          epoch: st.epoch,
          events: batch.map(({ opId, type, at, payload }) => ({ opId, type, at, payload })),
        });
        if (r.status === 200) {
          const acked = new Set((r.json.results as { opId: string; status: string }[]).filter((x) => x.status === 'APPLIED' || x.status === 'DUPLICATE').map((x) => x.opId));
          // 佇列確認與已確認的 revision／epoch 同一次寫入；寫入失敗 → localSaveFailed（不算完成）
          this.commit((d) => {
            d.outbox = d.outbox.filter((e) => !acked.has(e.opId));
            d.seenRev = Math.max(d.seenRev, r.json.rev);
            d.epoch = r.json.epoch;
          });
          sent += acked.size;
          const again = await this.read(petId);
          if (typeof again === 'string') return done(again);
          st = again;
          continue;
        }
        const err = r.json?.error;
        if (r.status === 409 && (err === 'REVISION_CONFLICT' || err === 'STALE_EPOCH' || err === 'NOT_CONTROLLER')) {
          // 重新讀取後用同樣的 opId 重送（增量事件可以安全地套在新版本上）
          const again = await this.read(petId);
          if (typeof again === 'string') return done(again);
          st = again;
          continue;
        }
        if ((r.status === 409 && err === 'ID_COLLISION') || r.status === 400 || r.status === 403) {
          if (batch.length > 1) {
            singleMode = true; // 一筆一筆送，找出是哪一筆
            continue;
          }
          const bad = batch[0];
          this.commit((d) => {
            d.dead.push({ ...bad, why: `${r.status} ${err ?? ''}` });
            d.outbox = d.outbox.filter((e) => e.opId !== bad.opId);
          });
          continue;
        }
        if (r.status === 507) return done('capacity');
        return done('unavailable', `${r.status} ${err ?? ''}`);
      }
      this.adopt(st, handoverFromMc);
      if (this.p.outbox.some((e) => NUMERIC.includes(e.type))) {
        if (st.controller?.role === 'mc') return done('waitingControl');
      }
      return done(this.p.outbox.length ? 'unavailable' : 'ok');
    } catch (e) {
      if (e instanceof LocalSaveError) return done('localSaveFailed');
      return done('offline', String((e as Error)?.message ?? e));
    } finally {
      this.busy = false;
    }
  }

  /** 主人明確要求「把悅靈叫回手機」：即使 Minecraft 正在控制也取得控制權 */
  takeover(): Promise<SyncResult> {
    return this.sync({ takeover: true });
  }

  /** 讀取 Hub 的狀態；回傳狀態物件，或停止原因。讀取失敗不會改動已確認的版本 */
  private async read(petId: string): Promise<HubState | SyncStatus> {
    const r = await this.send!('GET', `/api/allay/state?pet=${encodeURIComponent(petId)}`);
    if (r.status === 404) return 'hubMissing';
    if (r.status !== 200) return r.status === 503 ? 'unavailable' : 'error';
    const st = r.json as HubState;
    // 防倒退：Hub 的版本比已確認的小 → 停止，不採用、不送出、保留佇列
    if (st.rev < this.p!.seenRev) return 'hubRollback';
    if (st.rev !== this.p!.seenRev || st.epoch !== this.p!.epoch)
      this.commit((d) => {
        d.seenRev = st.rev;
        d.epoch = st.epoch;
      });
    return st;
  }

  private async claim(petId: string, rev: number): Promise<'ok' | 'conflict' | SyncStatus> {
    if (!this.p!.claimOpId)
      this.commit((d) => {
        d.seq++;
        d.claimOpId = `claim-${d.sourceId.slice(-8)}-${d.seq}`;
      });
    const r = await this.send!('POST', '/api/allay/control/claim', { pet: petId, baseRevision: rev, opId: this.p!.claimOpId });
    if (r.status === 200) {
      this.commit((d) => {
        d.claimOpId = null;
        d.seenRev = Math.max(d.seenRev, r.json.rev);
        d.epoch = Math.max(d.epoch, r.json.epoch);
      });
      return 'ok';
    }
    if (r.status === 409 && r.json?.error === 'REVISION_CONFLICT') return 'conflict';
    return r.status >= 500 ? 'unavailable' : 'error';
  }

  /** 採用 Hub 的資料：佇列清空後才採用名字、感情、統計；從 Minecraft 接回控制權時也採用生活數值 */
  private adopt(st: HubState, handoverFromMc: boolean): void {
    const p = this.p!;
    const r: RemoteApply = { rev: st.rev, sharedMemories: (st.memories ?? []).filter((m) => m.src === 'mc').map((m) => String(m.text)) };
    const pendingRename = p.outbox.some((e) => e.type === 'RENAME');
    const pendingNumeric = p.outbox.some((e) => NUMERIC.includes(e.type));
    if (!pendingRename) r.name = st.profile?.name;
    if (!pendingNumeric) {
      r.affection = st.state?.affection;
      r.stats = st.stats;
    }
    if (handoverFromMc && st.state) r.vitals = { health: st.state.health, hunger: st.state.hunger, energy: st.state.energy, mood: st.state.mood, asleep: st.state.asleep };
    this.o.applyRemote(r);
  }
}

/** 本機 PetState → Hub 登記用的格式（v0.49.2 的欄位，原樣送出，由 Hub 嚴格驗證） */
export function toPocketState(p: PetState): PetState {
  return {
    version: p.version, id: p.id, name: p.name, personality: p.personality,
    health: p.health, hunger: p.hunger, energy: p.energy, affection: p.affection, mood: p.mood,
    asleep: p.asleep, onboarded: p.onboarded, createdAt: p.createdAt, lastSeen: p.lastSeen,
    stats: { ...p.stats }, memory: { ...p.memory, foods: { ...p.memory.foods }, told: [...p.memory.told] },
  };
}
