// 悅靈發言音效（Fairy Pocket 音效標準）：
// 每次發言同時播放原版悅靈叫聲（entity.allay.ambient_with_item，4 種隨機）
// 與紫水晶鈴聲（block.amethyst_block.chime）。音檔來自玩家自己的原版素材包。

import type { Personality } from './game/state';
import { packFile, type AssetPack } from './game/assets';
import type { Syllable } from './voice';

export type SoundMode = 'bright' | 'soft' | 'off';

export const SOUND_MODES: Record<SoundMode, { label: string; allay: number; chime: number; chimePitch: number }> = {
  bright: { label: '明亮', allay: 1, chime: 0.58, chimePitch: 1.5 },
  soft: { label: '柔和', allay: 0.52, chime: 0.21, chimePitch: 1.35 },
  off: { label: '關閉', allay: 0, chime: 0, chimePitch: 1 },
};

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

  constructor(private storage: Pick<Storage, 'getItem' | 'setItem'>) {
    this.mode = loadSoundMode(storage);
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
  async play(path: string, volume: number, rate = 1, pan = 0): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || volume <= 0) return;
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
    node.connect(this.output(ctx));
    src.start();
  }

  /** 一般音效（音符盒等），音量跟著聲音模式 */
  effect(path: string, volume = 1, rate = 1, pan = 0): void {
    void this.play(path, volume * SOUND_MODES[this.mode].allay, rate, pan);
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

  /**
   * 悅靈語：用原版悅靈叫聲的短片段，照玩家說話的音節數、節奏與高低回答。
   * 回傳大約要講多久（秒），聲音模式關閉時回傳 0。
   */
  async babble(p: Personality, syl: Syllable[]): Promise<number> {
    const ctx = this.ctx;
    const m = SOUND_MODES[this.mode];
    if (!ctx || ctx.state !== 'running' || m.allay <= 0 || !syl.length) return 0;
    const bufs = (await Promise.all(VOICES.map((v) => this.buffer(this.resolve(v))))).filter((x): x is AudioBuffer => !!x);
    if (!bufs.length) return 0;
    const t0 = ctx.currentTime + 0.05;
    let end = 0;
    for (const s of syl) {
      const buf = bufs[Math.floor(Math.random() * bufs.length)];
      const dur = Math.min(0.26, Math.max(0.09, s.dur));
      const at = t0 + s.t * 0.9;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      // 跟著玩家這個音節的高低，在悅靈原本的音高上下調整
      src.playbackRate.value = allayRate(p) * Math.min(1.25, Math.max(0.8, Math.pow(s.rel, 0.6)));
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(m.allay, at + 0.02);
      g.gain.setValueAtTime(m.allay, at + dur - 0.04);
      g.gain.linearRampToValueAtTime(0, at + dur);
      src.connect(g).connect(this.output(ctx));
      const offset = Math.random() * Math.max(0, Math.min(0.35, buf.duration - dur * src.playbackRate.value - 0.05));
      src.start(at, offset, dur * src.playbackRate.value + 0.02);
      end = Math.max(end, s.t * 0.9 + dur);
    }
    // 講完再響一聲紫水晶
    setTimeout(() => void this.play(CHIME, m.chime, m.chimePitch), (end + 0.05) * 1000);
    return end + 0.3;
  }

  /** 播放設定頁錄的回應（保持原本的聲音，前面加一聲紫水晶）；回傳長度（秒） */
  playClip(buf: AudioBuffer): number {
    const ctx = this.ctx;
    const m = SOUND_MODES[this.mode];
    if (!ctx || ctx.state !== 'running' || m.allay <= 0) return 0;
    void this.play(CHIME, m.chime, m.chimePitch);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = Math.min(1.5, m.allay * 1.4);
    src.connect(g).connect(this.output(ctx));
    src.start(ctx.currentTime + 0.15);
    return buf.duration + 0.3;
  }

  /** 悅靈發言：悅靈叫聲 + 紫水晶鈴聲 */
  speak(p: Personality): void {
    const m = SOUND_MODES[this.mode];
    void this.play(VOICES[Math.floor(Math.random() * VOICES.length)], m.allay, allayRate(p));
    void this.play(CHIME, m.chime, m.chimePitch);
  }
}
