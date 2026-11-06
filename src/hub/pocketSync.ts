// FairyPocket ↔ Fairy Hub 同步適配器（H3-1：最小、隔離；尚未接進 App 畫面）
//
// 原則（與 Hub v1 契約一致）：
// - 只送「事件」，不送整份快照（VITALS_SYNC 停用中，這裡也沒有任何送數值快照的方法）
// - 每個本機動作先寫進「待送佇列」（存在本機），送成功（APPLIED 或 DUPLICATE）才移除 → 斷線、重啟都不會遺失或重複
// - opId 由穩定的裝置來源 ID＋遞增序號組成，重送時不變 → Hub 去重，不會重複計算
// - revision 衝突：重新讀取後，用「同樣的 opId」把同一批事件重送到新的版本上（本機事件都是增量或附加，可以安全地重新套用）
// - 控制權：要送會改數值的事件時才取得；Minecraft 正在控制時「不搶」，數值事件留在佇列等待（只有主人明確按「叫回手機」才接管）
// - 交接：從 Minecraft 手上接回控制權時，採用 Hub 的數值（Minecraft 期間的變化），之後手機繼續當生活模擬的權威
// - 防倒退：Hub 的 revision 比上次看到的還小（例如還原了舊備份）→ 停止同步、不採用任何遠端數值、保留佇列

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

export interface QueuedEvent {
  opId: string;
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

export type SyncStatus = 'ok' | 'offline' | 'waitingControl' | 'hubRollback' | 'hubMissing' | 'unavailable' | 'capacity' | 'busy' | 'error';
export interface SyncResult {
  status: SyncStatus;
  sent: number;
  pending: number;
  rev?: number;
  detail?: string;
}

interface Persisted {
  v: 1;
  sourceId: string;
  petId: string | null;
  registered: boolean;
  seq: number;
  outbox: QueuedEvent[];
  /** 送不出去、也不能重送的事件（例如同 ID 不同內容），保留給人檢查 */
  dead: (QueuedEvent & { why: string })[];
  /** 上次看到的 Hub 版本（只增不減，用來發現倒退） */
  seenRev: number;
  epoch: number;
  /** 已同步的本機記憶：文字 → memoryId */
  syncedNotes: Record<string, string>;
  /** 進行中的取得控制權操作（重送時沿用同一個 opId） */
  claimOpId: string | null;
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

function newSourceId(): string {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return `pocket-${[...b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
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
  private p: Persisted;
  private busy = false;
  private readonly send: Transport;
  private readonly now: () => number;

  constructor(private readonly o: PocketSyncOptions) {
    this.now = o.now ?? (() => Date.now());
    this.p = this.load();
    this.send = o.transport(this.p.sourceId);
  }

  // ---------- 本機狀態 ----------
  private load(): Persisted {
    try {
      const v = JSON.parse(this.o.storage.getItem(SYNC_KEY) ?? 'null') as Persisted | null;
      if (v && v.v === 1 && typeof v.sourceId === 'string' && Array.isArray(v.outbox)) return v;
    } catch {
      /* 壞掉就重建（佇列遺失只會少送，不會重複） */
    }
    const fresh: Persisted = { v: 1, sourceId: newSourceId(), petId: null, registered: false, seq: 0, outbox: [], dead: [], seenRev: 0, epoch: 0, syncedNotes: {}, claimOpId: null };
    this.o.storage.setItem(SYNC_KEY, JSON.stringify(fresh));
    return fresh;
  }
  private save(): void {
    this.o.storage.setItem(SYNC_KEY, JSON.stringify(this.p));
  }
  private nextOp(prefix: string): string {
    this.p.seq++;
    return `${prefix}-${this.p.sourceId.slice(-8)}-${this.p.seq}`;
  }
  private queue(type: QueuedEvent['type'], payload: Record<string, unknown>): QueuedEvent {
    const e: QueuedEvent = { opId: this.nextOp('fp'), type, at: this.now(), payload };
    this.p.outbox.push(e);
    this.save(); // 先存進本機，才算記下這個動作
    return e;
  }

  /** 給 UI／測試看的狀態 */
  info() {
    return { sourceId: this.p.sourceId, petId: this.p.petId, registered: this.p.registered, pending: this.p.outbox.length, dead: this.p.dead.length, seenRev: this.p.seenRev, epoch: this.p.epoch, outbox: this.p.outbox.map((e) => ({ ...e })) };
  }

  // ---------- 記下本機動作（App 在原本的 feed／pet／play／改名之後呼叫） ----------
  recordFed(food: string): void {
    this.queue('FED', { food });
  }
  recordPetted(): void {
    this.queue('PETTED', {});
  }
  recordPlayed(): void {
    this.queue('PLAYED', {});
  }
  recordRename(name: string): void {
    this.queue('RENAME', { name });
  }
  recordDialogue(who: 'user' | 'allay', name: string, text: string): void {
    const opId = this.nextOp('fp');
    this.p.outbox.push({ opId, type: 'DIALOGUE_ADD', at: this.now(), payload: { messageId: `msg-${opId}`, who, name, text: text.slice(0, 200) } });
    this.save();
  }
  /** 比對本機記憶與已同步的記憶，產生新增／刪除事件（同一句記憶永遠是同一個 memoryId） */
  syncNotes(): void {
    const notes = new Set(this.o.getNotes().map((n) => n.trim()).filter(Boolean));
    for (const text of notes) if (!this.p.syncedNotes[text]) {
      const memoryId = noteId(text);
      this.queue('MEMORY_ADD', { memoryId, text: [...text].slice(0, 60).join(''), visibility: 'private' });
      this.p.syncedNotes[text] = memoryId;
    }
    for (const [text, memoryId] of Object.entries(this.p.syncedNotes)) if (!notes.has(text)) {
      this.queue('MEMORY_REMOVE', { memoryId });
      delete this.p.syncedNotes[text];
    }
    this.save();
  }

  // ---------- 同步 ----------
  /** 同步一次：登記 → 讀取 → （必要時取得控制權）→ 送出佇列 → 採用遠端資料 */
  async sync(opts: { takeover?: boolean } = {}): Promise<SyncResult> {
    if (this.busy) return { status: 'busy', sent: 0, pending: this.p.outbox.length };
    this.busy = true;
    let sent = 0;
    const done = (status: SyncStatus, detail?: string): SyncResult => {
      this.save();
      return { status, sent, pending: this.p.outbox.length, rev: this.p.seenRev, detail };
    };
    try {
      const pet = this.o.getPet();
      if (!this.p.registered) {
        const r = await this.send('POST', '/api/allay/pet/register', { petState: toPocketState(pet) });
        if (r.status !== 201 && !(r.status === 409 && r.json?.error === 'EXISTS')) return done(r.status >= 500 ? 'unavailable' : 'error', `register ${r.status} ${r.json?.error ?? ''}`);
        this.p.registered = true;
        this.p.petId = pet.id;
        this.save();
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
        const r = await this.send('POST', '/api/allay/events', {
          pet: petId,
          baseRevision: st.rev,
          epoch: st.epoch,
          events: batch.map(({ opId, type, at, payload }) => ({ opId, type, at, payload })),
        });
        if (r.status === 200) {
          const acked = new Set((r.json.results as { opId: string; status: string }[]).filter((x) => x.status === 'APPLIED' || x.status === 'DUPLICATE').map((x) => x.opId));
          sent += [...acked].length;
          this.p.outbox = this.p.outbox.filter((e) => !acked.has(e.opId));
          this.save();
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
          this.p.dead.push({ ...batch[0], why: `${r.status} ${err ?? ''}` });
          this.p.outbox = this.p.outbox.filter((e) => e.opId !== batch[0].opId);
          this.save();
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
      return done('offline', String((e as Error)?.message ?? e));
    } finally {
      this.busy = false;
    }
  }

  /** 主人明確要求「把悅靈叫回手機」：即使 Minecraft 正在控制也取得控制權 */
  takeover(): Promise<SyncResult> {
    return this.sync({ takeover: true });
  }

  /** 讀取 Hub 的狀態；回傳狀態物件，或停止原因 */
  private async read(petId: string): Promise<HubState | SyncStatus> {
    const r = await this.send('GET', `/api/allay/state?pet=${encodeURIComponent(petId)}`);
    if (r.status === 404) return 'hubMissing';
    if (r.status !== 200) return r.status === 503 ? 'unavailable' : 'error';
    const st = r.json as HubState;
    // 防倒退：Hub 的版本比上次看到的小 → 停止，不採用、不送出
    if (st.rev < this.p.seenRev) return 'hubRollback';
    this.p.seenRev = st.rev;
    this.p.epoch = st.epoch;
    return st;
  }

  private async claim(petId: string, rev: number): Promise<'ok' | 'conflict' | SyncStatus> {
    this.p.claimOpId ??= this.nextOp('claim');
    this.save();
    const r = await this.send('POST', '/api/allay/control/claim', { pet: petId, baseRevision: rev, opId: this.p.claimOpId });
    if (r.status === 200) {
      this.p.claimOpId = null;
      return 'ok';
    }
    if (r.status === 409 && r.json?.error === 'REVISION_CONFLICT') return 'conflict';
    return r.status >= 500 ? 'unavailable' : 'error';
  }

  /** 採用 Hub 的資料：佇列清空後才採用名字、感情、統計；從 Minecraft 接回控制權時也採用生活數值 */
  private adopt(st: HubState, handoverFromMc: boolean): void {
    const r: RemoteApply = { rev: st.rev, sharedMemories: (st.memories ?? []).filter((m) => m.src === 'mc').map((m) => String(m.text)) };
    const pendingRename = this.p.outbox.some((e) => e.type === 'RENAME');
    const pendingNumeric = this.p.outbox.some((e) => NUMERIC.includes(e.type));
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
