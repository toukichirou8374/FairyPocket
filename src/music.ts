// 背景音樂與唱片機（素材包裡的原版音樂，只在玩家自己的裝置上播放）。
// 背景音樂像原版一樣安靜地播：一首放完後安靜一段時間再換下一首。
// 唱片機放歌時背景音樂暫停。能用串流播放就用串流（省記憶體），不行才整首解碼。

import type { AssetPack } from './game/assets';
import { packFile } from './game/assets';
import type { Sound } from './audio';

/** 3 首原版經典背景音樂（C418）：Minecraft、Sweden、Wet Hands（26.3 起檔名改成曲名） */
export const BGM = ['sounds/music/game/minecraft', 'sounds/music/game/sweden', 'sounds/music/game/wet_hands'];

/** 唱片機的 3 張唱片（安靜、溫馨的三首） */
export const DISCS = [
  { id: 'creator_music_box', path: 'sounds/records/creator_music_box', tex: 'textures/item/music_disc_creator_music_box.png', title: 'Lena Raine - Creator (Music Box)' },
  { id: 'far', path: 'sounds/records/far', tex: 'textures/item/music_disc_far.png', title: 'C418 - far' },
  { id: 'relic', path: 'sounds/records/relic', tex: 'textures/item/music_disc_relic.png', title: 'Aaron Cherof - Relic' },
] as const;

const BGM_KEY = 'fairypocket.bgm.v1';
/** 背景音樂與唱片的音量（再乘上聲音模式），偏安靜 */
const BGM_VOL = 0.22;
const DISC_VOL = 0.45;

interface Track {
  stop(): void;
}

export class Music {
  private pack: AssetPack | null = null;
  private bgm: Track | null = null;
  private disc: Track | null = null;
  private timer = 0;
  /** 目前唱片機放的唱片（-1 = 沒有） */
  discIndex = -1;
  enabled: boolean;

  constructor(private sound: Sound, private storage: Pick<Storage, 'getItem' | 'setItem'>) {
    this.enabled = storage.getItem(BGM_KEY) !== '0';
  }

  get available(): boolean {
    return !!this.pack && BGM.some((p) => packFile(this.pack!, p));
  }

  usePack(p: AssetPack | null): void {
    this.pack = p;
    this.schedule(15);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.storage.setItem(BGM_KEY, on ? '1' : '0');
    if (!on) {
      this.bgm?.stop();
      this.bgm = null;
    } else this.schedule(2);
  }

  /** 過一段時間再播下一首背景音樂 */
  private schedule(sec: number): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.nextBgm(), sec * 1000);
  }

  private async nextBgm(): Promise<void> {
    if (!this.enabled || this.disc || this.bgm || document.hidden) return this.schedule(30);
    const ready = BGM.filter((p) => this.pack && packFile(this.pack, p));
    if (!ready.length) return;
    const path = ready[Math.floor(Math.random() * ready.length)];
    this.bgm = await this.play(path, BGM_VOL, () => {
      this.bgm = null;
      // 一首放完安靜 1～2 分鐘
      this.schedule(60 + Math.random() * 60);
    });
    if (!this.bgm) this.schedule(60);
  }

  /** 唱片機：放下一張唱片；最後一張之後停止。回傳正在放的唱片名稱（停止時為 null） */
  async nextDisc(): Promise<string | null> {
    this.disc?.stop();
    this.disc = null;
    this.discIndex = this.discIndex + 1 >= DISCS.length ? -1 : this.discIndex + 1;
    if (this.discIndex < 0) {
      this.schedule(20);
      return null;
    }
    this.bgm?.stop();
    this.bgm = null;
    const d = DISCS[this.discIndex];
    this.disc = await this.play(d.path, DISC_VOL, () => {
      this.disc = null;
      this.discIndex = -1;
      this.schedule(30);
    });
    return this.disc ? d.title : null;
  }

  stopDisc(): void {
    this.disc?.stop();
    this.disc = null;
    this.discIndex = -1;
    this.schedule(20);
  }

  get playingDisc(): boolean {
    return !!this.disc;
  }

  /** 切到背景時停止，回來再慢慢開始 */
  pause(hidden: boolean): void {
    if (hidden) {
      this.bgm?.stop();
      this.bgm = null;
    } else this.schedule(10);
  }

  private async play(path: string, volume: number, onEnd: () => void): Promise<Track | null> {
    const ctx = this.sound.context;
    const out = this.sound.musicOut();
    const blob = this.pack && packFile(this.pack, path);
    if (!ctx || !out || !blob) return null;
    const gain = ctx.createGain();
    gain.gain.value = volume * this.sound.musicVolume();
    gain.connect(out);
    let ended = false;
    const finish = () => {
      if (ended) return;
      ended = true;
      gain.disconnect();
      onEnd();
    };
    // 瀏覽器能直接播 OGG 時用串流（不佔記憶體）
    const audio = document.createElement('audio');
    if (audio.canPlayType('audio/ogg; codecs="vorbis"')) {
      const url = URL.createObjectURL(blob);
      audio.src = url;
      audio.preload = 'auto';
      const src = ctx.createMediaElementSource(audio);
      src.connect(gain);
      audio.onended = () => {
        URL.revokeObjectURL(url);
        finish();
      };
      try {
        await audio.play();
      } catch {
        URL.revokeObjectURL(url);
        gain.disconnect();
        return null;
      }
      return {
        stop: () => {
          audio.pause();
          URL.revokeObjectURL(url);
          ended = true;
          gain.disconnect();
        },
      };
    }
    // 不行就解碼成單聲道再播
    const buf = await this.sound.decodeMono(blob);
    if (!buf) {
      gain.disconnect();
      return null;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(gain);
    src.onended = finish;
    src.start();
    return {
      stop: () => {
        ended = true;
        src.onended = null;
        try {
          src.stop();
        } catch {
          // 已經停了
        }
        gain.disconnect();
      },
    };
  }
}
