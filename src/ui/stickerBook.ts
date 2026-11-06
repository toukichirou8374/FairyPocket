// 貼紙簿：跟精靈舞蹈共用題目，不管語言全部類別都顯示。
// 字母、注音、假名的錄音不分語言；數字、圖案、時間依語言分開存（各語言念法不同）。
// 錄好的貼紙也是精靈舞蹈「聲音」玩法的題目。
// 錄製模式：點貼紙打開錄音視窗，按「錄音」後倒數 3 秒才開始錄（說完自動停），錄完可以馬上聽、用變聲聽、重錄或刪除。
// 收聽模式：點貼紙播放錄好的聲音，可以選原本的聲音或變聲。錄音存在這台裝置，匯出存檔時會一起帶走。

import { clipKey, demoSpeech, isShared, itemFace, itemName, SB_CATS, stickerBookItems, type SbCat, type SbItem } from '../game/sbItems';
import { stickerCanvas } from '../game/stickers';
import { getLang, LANGS, t, type Lang } from '../i18n';
import type { Clip } from '../voice';

export interface StickerBookHost {
  root: HTMLElement;
  click(): void;
  /** 開始錄音（說完會自動停）；麥克風不能用時回傳 null */
  record(): Promise<{ stop: () => void; done: Promise<Clip | null> } | null>;
  /** 播放錄音；changed = 用目前選的變聲；回傳長度（秒） */
  play(c: Clip, changed: boolean): number;
  /** 悅靈示範發音（裝置內建語音）；念完時結束 */
  demo(text: string, lang: Lang): Promise<void>;
  /** 目前選的變聲名稱 */
  voiceName(): string;
  /** 讀出所有錄音（存檔名 → 錄音） */
  load(): Promise<Map<string, Clip>>;
  save(key: string, c: Clip | null): Promise<void>;
  /** 背景音樂：開始、停止、錄音和播放時調小聲 */
  musicStart(): void;
  musicStop(): void;
  musicDuck(level: number): void;
}

export { SB_CATS, stickerBookItems, type SbCat, type SbItem };

const CAT_KEY = 'fairypocket.stickerbook.cat.v1';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  parent?.appendChild(e);
  return e;
}

export class StickerBook {
  private layer: HTMLDivElement | null = null;
  private clips = new Map<string, Clip>();
  /** 預設是「聽」：先聽、要錄音再切過去，避免不小心蓋掉以前的錄音 */
  private mode: 'record' | 'listen' = 'listen';
  private cat: SbCat = 'letter';
  private changed = false;
  private items = stickerBookItems();
  private grid: HTMLElement | null = null;
  private help: HTMLElement | null = null;

  constructor(private host: StickerBookHost) {
    const c = localStorage.getItem(CAT_KEY) as SbCat | null;
    if (c && SB_CATS.includes(c)) this.cat = c;
  }

  async open(): Promise<void> {
    this.close();
    this.clips = await this.host.load();
    this.host.musicStart();
    const layer = el('div', 'sb', this.host.root);
    this.layer = layer;
    this.host.root.classList.add('kg-on');

    const top = el('div', 'sb-top', layer);
    const exit = el('button', 'btn kg-exit', top);
    exit.textContent = '✕';
    exit.addEventListener('click', () => {
      this.host.click();
      this.close();
    });
    el('div', 'sb-title', top).textContent = t('game.sticker');
    const modes = el('div', 'sb-modes', top);
    for (const m of ['listen', 'record'] as const) {
      const b = el('button', 'btn' + (m === this.mode ? ' on' : ''), modes);
      b.textContent = t(m === 'record' ? 'sb.record' : 'sb.listen');
      b.addEventListener('click', () => {
        this.host.click();
        this.mode = m;
        modes.querySelectorAll('.btn').forEach((x) => x.classList.toggle('on', x === b));
        this.render();
      });
    }

    const tabs = el('div', 'sb-tabs', layer);
    for (const c of SB_CATS) {
      const b = el('button', 'btn' + (c === this.cat ? ' on' : ''), tabs);
      b.textContent = t(`sb.cat.${c}`);
      b.addEventListener('click', () => {
        this.host.click();
        this.cat = c;
        localStorage.setItem(CAT_KEY, c);
        tabs.querySelectorAll('.btn').forEach((x) => x.classList.toggle('on', x === b));
        this.render();
      });
    }
    const bar = el('div', 'sb-bar', layer);
    this.help = el('div', 'sb-help', bar);
    const voice = el('button', 'btn sb-voice', bar);
    const showVoice = () => (voice.textContent = this.changed ? t('sb.fx', { v: this.host.voiceName() }) : t('sb.orig'));
    showVoice();
    voice.addEventListener('click', () => {
      this.host.click();
      this.changed = !this.changed;
      showVoice();
    });
    this.grid = el('div', 'sb-grid', layer);
    this.render();
  }

  private tile(it: SbItem, parent: HTMLElement, big = false): HTMLElement {
    const b = el('div', `sb-tile${it.sticker ? ' pic' : ''}${big ? ' big' : ''}`, parent);
    const face = el('div', 'sb-face', b);
    if (it.sticker) {
      face.appendChild(stickerCanvas(it.sticker, 6));
    } else {
      const f = itemFace(it, getLang());
      face.textContent = f;
      if (f.length > 2) face.classList.add('long');
      else if (f.length === 2) face.classList.add('mid');
    }
    const name = itemName(it, getLang());
    if (name) el('div', 'sb-name', b).textContent = name;
    return b;
  }

  private render(): void {
    if (!this.grid || !this.help) return;
    const per = SB_CATS.includes(this.cat) && !isShared({ id: '', cat: this.cat }) ? ' ' + t('sb.perLang', { l: LANGS[getLang()] }) : '';
    this.help.textContent = t(this.mode === 'record' ? 'sb.recHelp' : 'sb.listenHelp') + per;
    this.grid.replaceChildren();
    for (const it of this.items.filter((x) => x.cat === this.cat)) {
      const b = this.tile(it, this.grid);
      const has = this.clips.has(this.key(it));
      if (has) el('div', 'sb-badge', b).textContent = '♪';

      b.addEventListener('click', () => {
        if (this.mode === 'record') void this.recordPanel(it);
        else {
          const c = this.clips.get(this.key(it));
          // 有錄音就播錄音，沒有的話悅靈示範念法
          if (c) this.playDucked(c, this.changed);
          else this.demo(it);
          b.classList.remove('play');
          void b.offsetWidth;
          b.classList.add('play');
        }
      });
    }
  }

  private key(it: SbItem): string {
    return clipKey(it, getLang());
  }

  /** 播放錄音時背景音樂先調小聲 */
  private duckTimer = 0;
  private playDucked(c: Clip, changed: boolean): void {
    this.host.musicDuck(0.25);
    const len = this.host.play(c, changed);
    window.clearTimeout(this.duckTimer);
    this.duckTimer = window.setTimeout(() => this.host.musicDuck(1), (len + 0.3) * 1000);
  }

  /** 悅靈示範念法（背景音樂先調小聲） */
  private demo(it: SbItem): void {
    const d = demoSpeech(it, getLang());
    window.clearTimeout(this.duckTimer);
    this.host.musicDuck(0.25);
    void this.host.demo(d.text, d.lang).then(() => {
      if (this.layer) this.host.musicDuck(1);
    });
  }

  private flash(text: string): void {
    if (!this.layer) return;
    const f = el('div', 'sb-flash', this.layer);
    f.textContent = text;
    window.setTimeout(() => f.remove(), 1600);
  }

  /** 錄音視窗：按「錄音」倒數 3 秒後開始錄，說完自動停；之後可以聽、變聲聽、重錄、刪除 */
  private async recordPanel(it: SbItem): Promise<void> {
    if (!this.layer) return;
    this.host.click();
    const back = el('div', 'sb-panel', this.layer);
    const box = el('div', 'modal', back);
    this.tile(it, box, true);
    const status = el('div', 'sb-status', box);
    const row = el('div', 'btnrow', box);
    const row2 = el('div', 'btnrow', box);
    const done = el('button', 'btn primary', box);
    done.textContent = t('sb.done');
    done.addEventListener('click', () => {
      this.host.click();
      stop?.();
      back.remove();
      this.render();
    });
    let stop: (() => void) | null = null;

    const show = () => {
      row.replaceChildren();
      row2.replaceChildren();
      const c = this.clips.get(this.key(it));
      if (stop) {
        status.textContent = t('sb.recording');
        status.classList.add('rec');
        const s = el('button', 'btn', row);
        s.textContent = t('sb.stop');
        s.addEventListener('click', () => stop?.());
        return;
      }
      status.classList.remove('rec');
      status.textContent = c ? t('sb.recDone') : t('sb.noRec');
      const dm = el('button', 'btn', row);
      dm.textContent = t('sb.demo');
      dm.addEventListener('click', () => this.demo(it));
      if (c) {
        const p = el('button', 'btn', row);
        p.textContent = t('sb.playOrig');
        p.addEventListener('click', () => this.playDucked(c, false));
        const f = el('button', 'btn', row);
        f.textContent = t('sb.playFx', { v: this.host.voiceName() });
        f.addEventListener('click', () => this.playDucked(c, true));
      }
      const r = el('button', 'btn', row2);
      r.textContent = t(c ? 'sb.rerecord' : 'sb.recordBtn');
      r.addEventListener('click', () => {
        this.host.click();
        // 已經有錄音：先確認，避免不小心蓋掉
        if (c && !confirm(t('sb.rerecordAsk'))) return;
        void rec();
      });
      if (c) {
        const d = el('button', 'btn', row2);
        d.textContent = t('sb.delete');
        d.addEventListener('click', () => {
          this.host.click();
          this.clips.delete(this.key(it));
          void this.host.save(this.key(it), null);
          show();
        });
      }
    };

    let counting = false;
    const rec = async () => {
      if (counting || stop) return;
      // 倒數 3、2、1（只顯示數字，不念），讓小孩準備好
      counting = true;
      row.replaceChildren();
      row2.replaceChildren();
      status.classList.remove('rec');
      status.classList.add('count');
      for (const n of [3, 2, 1]) {
        if (!back.isConnected) return;
        status.textContent = String(n);
        status.classList.remove('tick');
        void status.offsetWidth;
        status.classList.add('tick');
        await new Promise((r) => window.setTimeout(r, 800));
      }
      status.classList.remove('count', 'tick');
      counting = false;
      if (!back.isConnected) return;
      // 錄音時背景音樂先停（避免錄進去）
      this.host.musicDuck(0);
      const r = await this.host.record();
      if (!r) {
        this.host.musicDuck(1);
        show();
        status.textContent = t('micDenied');
        return;
      }
      stop = r.stop;
      show();
      const clip = await r.done;
      stop = null;
      if (clip) {
        const k = this.key(it);
        this.clips.set(k, clip);
        await this.host.save(k, clip);
        // 錄好馬上播一次給你聽
        this.playDucked(clip, false);
      } else {
        this.host.musicDuck(1);
        this.flash(t('sb.nothing'));
      }
      if (back.isConnected) show();
    };
    show();
  }

  close(): void {
    if (this.layer) this.host.musicStop();
    window.clearTimeout(this.duckTimer);
    this.layer?.remove();
    this.layer = null;
    this.grid = null;
    this.help = null;
    this.host.root.classList.remove('kg-on');
  }
}
