// 悅靈發言音效（Fairy Pocket 音效標準）：
// 每次發言同時播放原版悅靈叫聲（entity.allay.ambient_with_item，4 種隨機）
// 與紫水晶鈴聲（block.amethyst_block.chime）。音檔來自玩家自己的原版素材包。

import type { Personality } from './game/state';
import { SOUND_KEYS, type AssetPack, type SoundKey } from './game/assets';

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
const VOICES: SoundKey[] = ['allay_with_item1', 'allay_with_item2', 'allay_with_item3', 'allay_with_item4'];

export function loadSoundMode(storage: Pick<Storage, 'getItem'>): SoundMode {
  const m = storage.getItem(MODE_KEY);
  return m === 'soft' || m === 'off' ? m : 'bright';
}

export class Sound {
  mode: SoundMode;
  private ctx: AudioContext | null = null;
  private buffers: Partial<Record<SoundKey, AudioBuffer>> = {};
  private sources: Partial<Record<SoundKey, string>> = {};

  constructor(private storage: Pick<Storage, 'getItem' | 'setItem'>) {
    this.mode = loadSoundMode(storage);
    // 遵循 iPhone 靜音模式，並可與其他 App 的音訊混合
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session) session.type = 'ambient';
  }

  get available(): boolean {
    return VOICES.some((k) => this.sources[k]);
  }

  setMode(m: SoundMode): void {
    this.mode = m;
    this.storage.setItem(MODE_KEY, m);
  }

  usePack(p: AssetPack): void {
    this.buffers = {};
    this.sources = {};
    for (const k of SOUND_KEYS) if (p.files[k]) this.sources[k] = p.files[k];
    if (this.ctx) void this.decodeAll();
  }

  /** iOS 只允許在使用者觸控時啟用音訊 */
  unlock(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      void this.decodeAll();
    }
    if (this.ctx.state !== 'running') void this.ctx.resume();
  }

  private async decodeAll(): Promise<void> {
    const ctx = this.ctx!;
    await Promise.all(
      (Object.entries(this.sources) as [SoundKey, string][]).map(async ([k, src]) => {
        try {
          const data = await (await fetch(src)).arrayBuffer();
          this.buffers[k] = await ctx.decodeAudioData(data);
        } catch {
          // 無法解碼就略過這個音效
        }
      }),
    );
  }

  private play(key: SoundKey, volume: number, rate: number): void {
    const ctx = this.ctx;
    const buf = this.buffers[key];
    if (!ctx || !buf || volume <= 0 || ctx.state !== 'running') return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    src.connect(gain).connect(ctx.destination);
    src.start();
  }

  /** 悅靈發言：悅靈叫聲 + 紫水晶鈴聲 */
  speak(p: Personality): void {
    const m = SOUND_MODES[this.mode];
    const voices = VOICES.filter((k) => this.buffers[k]);
    if (voices.length) this.play(voices[Math.floor(Math.random() * voices.length)], m.allay, allayRate(p));
    this.play('amethyst_chime', m.chime, m.chimePitch);
  }
}
