// 貼紙簿：跟精靈舞蹈共用題目（字母、數字、注音、假名、動物、交通工具、食物），不管語言全部顯示。
// 錄製模式：點貼紙就開始錄音（說完自動停），錄完可以馬上聽、用變聲聽、重錄或刪除。
// 收聽模式：點貼紙播放錄好的聲音，可以選原本的聲音或變聲。錄音只存在這台裝置。

import { DIGITS, KANA, LETTERS, ZHUYIN } from '../game/keyGame';
import { STICKERS, stickerCanvas, type Sticker } from '../game/stickers';
import { getLang, t } from '../i18n';
import type { Clip } from '../voice';

export interface StickerBookHost {
  root: HTMLElement;
  click(): void;
  /** 開始錄音（說完會自動停）；麥克風不能用時回傳 null */
  record(): Promise<{ stop: () => void; done: Promise<Clip | null> } | null>;
  /** 播放錄音；changed = 用目前選的變聲 */
  play(c: Clip, changed: boolean): void;
  /** 目前選的變聲名稱 */
  voiceName(): string;
  load(): Promise<Map<string, Clip>>;
  save(id: string, c: Clip | null): Promise<void>;
}

export type SbCat = 'letter' | 'digit' | 'zhuyin' | 'kana' | 'animal' | 'vehicle' | 'food';
export const SB_CATS: SbCat[] = ['letter', 'digit', 'zhuyin', 'kana', 'animal', 'vehicle', 'food'];

export interface SbItem {
  id: string;
  cat: SbCat;
  /** 文字貼紙 */
  label?: string;
  /** 圖案貼紙 */
  sticker?: Sticker;
}

/** 貼紙簿的全部貼紙（不管語言全部列出） */
export function stickerBookItems(): SbItem[] {
  return [
    ...LETTERS.map((c) => ({ id: `letter:${c}`, cat: 'letter' as const, label: c })),
    ...DIGITS.map((c) => ({ id: `digit:${c}`, cat: 'digit' as const, label: c })),
    ...Object.keys(ZHUYIN).map((c) => ({ id: `zhuyin:${c}`, cat: 'zhuyin' as const, label: c })),
    ...Object.keys(KANA).map((c) => ({ id: `kana:${c}`, cat: 'kana' as const, label: c })),
    ...(['animal', 'vehicle', 'food'] as const).flatMap((cat) => STICKERS.filter((s) => s.cat === cat).map((s) => ({ id: `pic:${s.id}`, cat, sticker: s }))),
  ];
}

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
  private mode: 'record' | 'listen' = 'record';
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
    for (const m of ['record', 'listen'] as const) {
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
      el('div', 'sb-name', b).textContent = it.sticker.names[getLang()];
    } else face.textContent = it.label!;
    return b;
  }

  private render(): void {
    if (!this.grid || !this.help) return;
    this.help.textContent = t(this.mode === 'record' ? 'sb.recHelp' : 'sb.listenHelp');
    this.grid.replaceChildren();
    for (const it of this.items.filter((x) => x.cat === this.cat)) {
      const b = this.tile(it, this.grid);
      const has = this.clips.has(it.id);
      if (has) el('div', 'sb-badge', b).textContent = '♪';
      b.classList.toggle('empty', this.mode === 'listen' && !has);
      b.addEventListener('click', () => {
        if (this.mode === 'record') void this.recordPanel(it);
        else {
          const c = this.clips.get(it.id);
          if (c) {
            this.host.play(c, this.changed);
            b.classList.remove('play');
            void b.offsetWidth;
            b.classList.add('play');
          } else {
            this.host.click();
            this.flash(t('sb.none'));
          }
        }
      });
    }
  }

  private flash(text: string): void {
    if (!this.layer) return;
    const f = el('div', 'sb-flash', this.layer);
    f.textContent = text;
    window.setTimeout(() => f.remove(), 1600);
  }

  /** 錄音視窗：一打開就開始錄，說完自動停；之後可以聽、變聲聽、重錄、刪除 */
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
      const c = this.clips.get(it.id);
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
      if (c) {
        const p = el('button', 'btn', row);
        p.textContent = t('sb.playOrig');
        p.addEventListener('click', () => this.host.play(c, false));
        const f = el('button', 'btn', row);
        f.textContent = t('sb.playFx', { v: this.host.voiceName() });
        f.addEventListener('click', () => this.host.play(c, true));
      }
      const r = el('button', 'btn', row2);
      r.textContent = t(c ? 'sb.rerecord' : 'sb.recordBtn');
      r.addEventListener('click', () => {
        this.host.click();
        void rec();
      });
      if (c) {
        const d = el('button', 'btn', row2);
        d.textContent = t('sb.delete');
        d.addEventListener('click', () => {
          this.host.click();
          this.clips.delete(it.id);
          void this.host.save(it.id, null);
          show();
        });
      }
    };

    const rec = async () => {
      const r = await this.host.record();
      if (!r) {
        status.textContent = t('micDenied');
        return;
      }
      stop = r.stop;
      show();
      const clip = await r.done;
      stop = null;
      if (clip) {
        this.clips.set(it.id, clip);
        await this.host.save(it.id, clip);
        // 錄好馬上播一次給你聽
        this.host.play(clip, false);
      } else this.flash(t('sb.nothing'));
      if (back.isConnected) show();
    };
    show();
    void rec();
  }

  close(): void {
    this.layer?.remove();
    this.layer = null;
    this.grid = null;
    this.help = null;
    this.host.root.classList.remove('kg-on');
  }
}
