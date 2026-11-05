// 悅靈發言音效（Fairy Pocket 音效標準）：
// 每次發言同時播放原版悅靈叫聲（entity.allay.ambient_with_item，4 種隨機）
// 與紫水晶鈴聲（block.amethyst_block.chime）。音檔來自玩家自己的原版素材包。

import type { Personality } from './game/state';
import { packFile, type AssetPack } from './game/assets';
import { speakBabble } from './babble';

/** 悅靈語的音量倍率（實測：0.17 時平均音量跟上一版的「啾」差不多） */
export const BABBLE_LEVEL = 0.17;
/** 悅靈語的基本音高：依個性（愛玩最高、勇敢最低） */
export function babbleF0(p: Personality): number {
  return 330 * PERSONALITY_PITCH[p];
}

export type SoundMode = 'bright' | 'soft' | 'off';

export const SOUND_MODES: Record<SoundMode, { label: string; allay: number; chime: number; chimePitch: number }> = {
  bright: { label: '明亮', allay: 1, chime: 0.58, chimePitch: 1.5 },
  soft: { label: '柔和', allay: 0.52, chime: 0.21, chimePitch: 1.35 },
  off: { label: '關閉', allay: 0, chime: 0, chimePitch: 1 },
};

/** 情境音效整體音量（偏安靜） */
const EFFECT_LEVEL = 0.7;

/** 個性基礎音高 × 原版事件音高 1.25 */
const EVENT_PITCH = 1.25;
export const PERSONALITY_PITCH: Record<Personality, number> = {
  guardian: 1.22,
  brave: 1.1,
  cautious: 1.32,
  playful: 1.43,
};

export function allayRate(p: Personality): number {
  return PERSONALITY_PITCH[p] * EVENT_PITCH;
}

const MODE_KEY = 'fairypocket.sound.v1';
const VOICES = [1, 2, 3, 4].map((i) => `sounds/mob/allay/idle_with_item${i}`);
const CHIME = 'sounds/block/amethyst/shimmer';

/** 距離音量：3 公尺內全音量，越遠越小聲，最小 25% */
export function distanceGain(dist: number): number {
  return Math.max(0.25, Math.min(1, 3 / Math.max(dist, 0.01)));
}

/** 音量分類（像原版的「音樂與音效」設定） */
export type VolumeKind = 'master' | 'music' | 'records' | 'voice' | 'effects';
export const VOLUME_KINDS: VolumeKind[] = ['master', 'music', 'records', 'voice', 'effects'];
export type Volumes = Record<VolumeKind, number>;

const VOLUME_KEY = 'fairypocket.volume.v1';
const DEFAULT_VOLUMES: Volumes = { master: 1, music: 1, records: 1, voice: 1, effects: 1 };

/** 讀取音量設定；舊版的「聲音：關閉」與「背景音樂：關」會轉成新的設定 */
export function loadVolumes(storage: Pick<Storage, 'getItem'>): { vol: Volumes; muted: boolean } {
  try {
    const d = JSON.parse(storage.getItem(VOLUME_KEY) ?? 'null') as { vol?: Partial<Volumes>; muted?: boolean } | null;
    if (d) {
      const vol = { ...DEFAULT_VOLUMES };
      for (const k of VOLUME_KINDS) {
        const v = Number(d.vol?.[k]);
        if (Number.isFinite(v)) vol[k] = Math.max(0, Math.min(1, v));
      }
      return { vol, muted: !!d.muted };
    }
  } catch {
    // 壞掉就用預設
  }
  return {
    vol: { ...DEFAULT_VOLUMES, music: storage.getItem('fairypocket.bgm.v1') === '0' ? 0 : 1 },
    muted: storage.getItem(MODE_KEY) === 'off',
  };
}

export function loadSoundMode(storage: Pick<Storage, 'getItem'>): SoundMode {
  const m = storage.getItem(MODE_KEY);
  return m === 'soft' || m === 'off' ? m : 'bright';
}

/** 瀏覽器不支援 OGG 時（部分舊版 iPhone），改用內建解碼器 */
async function decodeOgg(ctx: AudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  const { OggVorbisDecoder } = await import('@wasm-audio-decoders/ogg-vorbis');
  const dec = new OggVorbisDecoder();
  await dec.ready;
  try {
    const { channelData, sampleRate, samplesDecoded } = await dec.decodeFile(new Uint8Array(data));
    const buf = ctx.createBuffer(channelData.length, samplesDecoded, sampleRate);
    channelData.forEach((c, i) => buf.copyToChannel(new Float32Array(c.subarray(0, samplesDecoded)), i));
    return buf;
  } finally {
    dec.free();
  }
}

export class Sound {
  mode: SoundMode;
  private ctx: AudioContext | null = null;
  private pack: AssetPack | null = null;
  private cache = new Map<string, Promise<AudioBuffer | null>>();

  /** 各分類的音量 0–1 與全部靜音 */
  vol: Volumes;
  muted: boolean;

  constructor(private storage: Pick<Storage, 'getItem' | 'setItem'>) {
    const v = loadVolumes(storage);
    this.vol = v.vol;
    this.muted = v.muted;
    // 舊版的「關閉」改成全部靜音；聲音模式只剩悅靈聲音的明亮／柔和
    this.mode = loadSoundMode(storage) === 'soft' ? 'soft' : 'bright';
    // 遵循 iPhone 靜音模式，並可與其他 App 的音訊混合
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session) session.type = 'ambient';
  }

  get available(): boolean {
    return !!this.pack && VOICES.some((v) => packFile(this.pack!, v));
  }

  setMode(m: SoundMode): void {
    this.mode = m;
    this.storage.setItem(MODE_KEY, m);
  }

  setVolume(k: VolumeKind, v: number): void {
    this.vol[k] = Math.max(0, Math.min(1, v));
    this.saveVolumes();
  }

  setMuted(on: boolean): void {
    this.muted = on;
    this.saveVolumes();
  }

  /** 某一類實際的音量（含主音量與全部靜音） */
  level(k: Exclude<VolumeKind, 'master'>): number {
    return this.muted ? 0 : this.vol.master * this.vol[k];
  }

  private saveVolumes(): void {
    this.storage.setItem(VOLUME_KEY, JSON.stringify({ vol: this.vol, muted: this.muted }));
    this.applyVolumes();
  }

  /** 音量改了立刻生效（正在播的音樂也會跟著變） */
  private applyVolumes(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.output(ctx).gain.setTargetAtTime(this.muted ? 0 : this.vol.master, t, 0.05);
    for (const [k, g] of this.buses) g.gain.setTargetAtTime(this.vol[k], t, 0.05);
  }

  private buses = new Map<Exclude<VolumeKind, 'master'>, GainNode>();
  /** 每一類聲音各有一個音量節點，再接到總輸出 */
  private bus(ctx: AudioContext, k: Exclude<VolumeKind, 'master'>): GainNode {
    let g = this.buses.get(k);
    if (!g) {
      g = ctx.createGain();
      g.gain.value = this.vol[k];
      g.connect(this.output(ctx));
      this.buses.set(k, g);
    }
    return g;
  }

  usePack(p: AssetPack | null): void {
    this.pack = p;
    this.cache.clear();
    this.variants.clear();
    this.preload();
  }

  /** iOS 只允許在使用者觸控時啟用音訊 */
  unlock(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.preload();
    }
    if (this.ctx.state !== 'running') void this.ctx.resume();
  }

  private preload(): void {
    if (this.ctx) for (const path of [...VOICES, CHIME]) void this.buffer(path);
  }

  /** 依原版路徑取得解碼後的音效（會快取） */
  private buffer(path: string): Promise<AudioBuffer | null> {
    let b = this.cache.get(path);
    if (!b) {
      b = this.decode(path);
      this.cache.set(path, b);
    }
    return b;
  }

  private async decode(path: string): Promise<AudioBuffer | null> {
    const ctx = this.ctx;
    const blob = this.pack && packFile(this.pack, path);
    if (!ctx || !blob) return null;
    const data = await blob.arrayBuffer();
    try {
      return await ctx.decodeAudioData(data.slice(0));
    } catch {
      try {
        return await decodeOgg(ctx, data);
      } catch {
        return null;
      }
    }
  }

  /**
   * 原版同一種音效常有好幾個版本（例如 random/eat1～3）：
   * 路徑沒有對應檔案時，就從 1、2、3… 的版本中隨機挑一個
   */
  private resolve(path: string): string {
    if (!this.pack || packFile(this.pack, path)) return path;
    let list = this.variants.get(path);
    if (!list) {
      list = [];
      for (let i = 1; i <= 20; i++) if (packFile(this.pack, `${path}${i}`)) list.push(`${path}${i}`);
      this.variants.set(path, list);
    }
    return list.length ? list[Math.floor(Math.random() * list.length)] : path;
  }
  private variants = new Map<string, string[]>();

  /** 播放任一原版音效，例如 play('sounds/random/pop', 0.5, 1.2)；pan -1（左）～ 1（右） */
  async play(path: string, volume: number, rate = 1, pan = 0, kind: Exclude<VolumeKind, 'master'> = 'effects'): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || volume <= 0 || this.level(kind) <= 0) return;
    const buf = await this.buffer(this.resolve(path));
    if (!buf || ctx.state !== 'running') return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    let node: AudioNode = src.connect(gain);
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      node = node.connect(p);
    }
    node.connect(this.bus(ctx, kind));
    src.start();
  }

  /** 一般音效；整體偏安靜（原音量的 7 成）。kind 決定用哪一類的音量 */
  effect(path: string, volume = 1, rate = 1, pan = 0, kind: Exclude<VolumeKind, 'master'> = 'effects'): void {
    void this.play(path, volume * EFFECT_LEVEL, rate, pan, kind);
  }

  // ---------- 音樂用 ----------

  /** 音樂接到這裡（錄影時也錄得到）：背景音樂用 music，唱片用 records */
  musicOut(kind: 'music' | 'records'): GainNode | null {
    return this.ctx ? this.bus(this.ctx, kind) : null;
  }

  /** 整首解碼並混成單聲道（瀏覽器不能串流播放 OGG 時用，省一半記憶體） */
  async decodeMono(blob: Blob): Promise<AudioBuffer | null> {
    const ctx = this.ctx;
    if (!ctx) return null;
    const data = await blob.arrayBuffer();
    let buf: AudioBuffer;
    try {
      buf = await ctx.decodeAudioData(data.slice(0));
    } catch {
      try {
        buf = await decodeOgg(ctx, data);
      } catch {
        return null;
      }
    }
    if (buf.numberOfChannels === 1) return buf;
    const mono = ctx.createBuffer(1, buf.length, buf.sampleRate);
    const out = mono.getChannelData(0);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < d.length; i++) out[i] += d[i] / buf.numberOfChannels;
    }
    return mono;
  }

  /**
   * 從畫面中某個位置發出的音效：離鏡頭越遠越小聲，左右聲道跟著位置
   * （之後做 AR 模式時，也用同一套距離音量）
   */
  effectAt(path: string, dist: number, x: number, volume = 1, rate = 1): void {
    this.effect(path, volume * distanceGain(dist), rate, Math.max(-0.8, Math.min(0.8, x / 2.5)));
  }

  /** 所有聲音都先經過這個節點，錄影時才能一起錄進去 */
  private out: GainNode | null = null;
  private output(ctx: AudioContext): GainNode {
    if (!this.out) {
      this.out = ctx.createGain();
      this.out.gain.value = this.muted ? 0 : this.vol.master;
      this.out.connect(ctx.destination);
    }
    return this.out;
  }

  /** 錄影用：悅靈聲音的音訊串流 */
  recordStream(): MediaStream | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const dest = ctx.createMediaStreamDestination();
    this.output(ctx).connect(dest);
    return dest.stream;
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  /** 播放（變聲後的）錄音回應，前面加一聲紫水晶鈴聲。回傳大約要播多久（秒） */
  playClip(buf: AudioBuffer): number {
    const ctx = this.ctx;
    const m = SOUND_MODES[this.mode];
    if (!ctx || ctx.state !== 'running' || this.level('voice') <= 0) return 0;
    void this.play(CHIME, m.chime, m.chimePitch, 0, 'voice');
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = Math.min(1.5, m.allay * 1.2);
    src.connect(g).connect(this.bus(ctx, 'voice'));
    src.start(ctx.currentTime + 0.15);
    return buf.duration + 0.3;
  }

  /** 悅靈發言：悅靈叫聲 + 紫水晶鈴聲 */
  /**
   * 悅靈語（像《動物森友會》那樣）：沒有做好的自然語音時，把話念成快快的音節（子音＋母音＋語調），見 babble.ts。
   * 開頭加一聲紫水晶鈴聲，聽得出是悅靈。回傳大約要念多久（秒）。
   */
  babble(text: string, p: Personality): number {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.level('voice') <= 0) return 0;
    const len = speakBabble(ctx, this.bus(ctx, 'voice'), text, { f0: babbleF0(p), level: SOUND_MODES[this.mode].allay * BABBLE_LEVEL });
    if (len) void this.play(CHIME, SOUND_MODES[this.mode].chime * 0.6, SOUND_MODES[this.mode].chimePitch, 0, 'voice');
    return len;
  }

  speak(p: Personality): void {
    const m = SOUND_MODES[this.mode];
    void this.play(VOICES[Math.floor(Math.random() * VOICES.length)], m.allay, allayRate(p), 0, 'voice');
    void this.play(CHIME, m.chime, m.chimePitch, 0, 'voice');
  }
}
