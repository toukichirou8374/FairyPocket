// 按鍵遊戲的畫面：選單（玩法、歌曲）→ 遊戲中（題目、分數、歌曲進度）→ 結果。
// 規則在 game/keyGame.ts；悅靈的動作、音樂、念名稱由 main.ts 提供。

import {
  gamepadPrompts,
  isModifier,
  keyboardPrompts,
  keyId,
  KeyRound,
  KG_SONGS,
  loadBest,
  PAD_BUTTONS,
  padFamily,
  saveBest,
  type KeyGameMode,
  type KgSong,
  type Prompt,
} from '../game/keyGame';
import { getLang, t } from '../i18n';

export interface KeyGameHost {
  /** 小遊戲的畫面放在這裡（hud 的根元素） */
  root: HTMLElement;
  click(): void;
  /** 音樂 */
  hasSong(path: string): boolean;
  playSong(path: string, onEnd: () => void): Promise<boolean>;
  stopSong(): void;
  songProgress(): number;
  /** 悅靈 */
  begin(): void;
  cheer(text: string): void;
  oops(): void;
  finish(score: number): void;
  end(): void;
  /** 念出按鍵名稱 */
  speak(text: string): void;
  /** 答錯的聲音 */
  wrong(): void;
}

const SPEAK_KEY = 'fairypocket.keygame.speak.v1';
const MODE_KEY = 'fairypocket.keygame.mode.v1';
/** 沒有歌的時候玩多久（秒） */
const NO_SONG_TIME = 120;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  parent?.appendChild(e);
  return e;
}

export class KeyGameUI {
  private layer: HTMLDivElement | null = null;
  private round: KeyRound | null = null;
  private mode: KeyGameMode = 'keyboard';
  private song: KgSong = 'cat';
  private keyEl: HTMLElement | null = null;
  private scoreEl: HTMLElement | null = null;
  private barEl: HTMLElement | null = null;
  private waitEl: HTMLElement | null = null;
  /** 這個時間之前不接受按鍵（答對後換題、答錯後懊惱時） */
  private lockUntil = 0;
  private raf = 0;
  private started = 0;
  private hasMusic = false;
  private ended = false;
  private padPrev: boolean[] = [];
  private padFam: ReturnType<typeof padFamily> | null = null;
  private speakOn: boolean;

  constructor(private host: KeyGameHost) {
    this.speakOn = localStorage.getItem(SPEAK_KEY) !== '0';
    const m = localStorage.getItem(MODE_KEY) as KeyGameMode | null;
    if (m === 'keyboard' || m === 'gamepad' || m === 'tap') this.mode = m;
  }

  get active(): boolean {
    return !!this.layer;
  }

  // ---------- 選單 ----------

  openMenu(): void {
    const back = el('div', 'modal-back', this.host.root);
    const box = el('div', 'modal kgmenu', back);
    box.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.btn')) this.host.click();
    });
    el('h2', '', box).textContent = t('games');
    el('div', 'kgcard-title', box).textContent = t('kg.title');
    el('div', 'info', box).textContent = t('kg.desc');

    el('label', '', box).textContent = t('kg.mode');
    const mrow = el('div', 'pgrid', box);
    const modes: KeyGameMode[] = ['keyboard', 'gamepad', 'tap', 'voice'];
    const songRow = () => songs.querySelectorAll<HTMLElement>('.btn').forEach((b) => (b.querySelector('.best')!.textContent = t('kg.best', { n: loadBest(localStorage, this.mode, b.dataset.song as KgSong) })));
    for (const m of modes) {
      const b = el('button', 'btn' + (m === this.mode ? ' on' : ''), mrow);
      b.textContent = t(`kg.mode.${m}`);
      if (m === 'voice') b.disabled = true;
      b.addEventListener('click', () => {
        this.mode = m;
        localStorage.setItem(MODE_KEY, m);
        mrow.querySelectorAll('.btn').forEach((x) => x.classList.toggle('on', x === b));
        songRow();
      });
    }

    el('label', '', box).textContent = t('kg.song');
    const songs = el('div', 'kgsongs', box);
    KG_SONGS.forEach((s, i) => {
      const b = el('button', 'btn' + (s.id === this.song ? ' on' : ''), songs);
      b.dataset.song = s.id;
      el('span', '', b).textContent = `${i + 1}. ${s.title.replace('C418 - ', '')}`;
      el('span', 'best', b);
      b.addEventListener('click', () => {
        this.song = s.id;
        songs.querySelectorAll('.btn').forEach((x) => x.classList.toggle('on', x === b));
      });
    });
    songRow();
    if (!KG_SONGS.some((s) => this.host.hasSong(s.path))) el('div', 'info', box).textContent = t('kg.noSong');

    const sp = el('button', 'btn' + (this.speakOn ? ' on' : ''), box);
    const showSp = () => (sp.textContent = `${t('kg.speak')}：${t(this.speakOn ? 'on' : 'off')}`);
    showSp();
    sp.addEventListener('click', () => {
      this.speakOn = !this.speakOn;
      localStorage.setItem(SPEAK_KEY, this.speakOn ? '1' : '0');
      sp.classList.toggle('on', this.speakOn);
      showSp();
    });

    const row = el('div', 'btnrow', box);
    const go = el('button', 'btn primary', row);
    go.textContent = t('kg.start');
    const close = el('button', 'btn', row);
    close.textContent = t('close');
    close.addEventListener('click', () => back.remove());
    go.addEventListener('click', () => {
      back.remove();
      void this.start();
    });
  }

  // ---------- 遊戲 ----------

  private prompts(): Prompt[] {
    const lang = getLang();
    if (this.mode === 'gamepad') return gamepadPrompts(this.padFam ?? 'xbox', lang);
    if (this.mode === 'tap') return [{ id: 'tap', label: '★', name: t('kg.tapMe'), speak: t('kg.good') }];
    return keyboardPrompts(lang);
  }

  private async start(): Promise<void> {
    this.stop(false);
    const layer = el('div', `kg kg-${this.mode}`, this.host.root);
    this.layer = layer;
    this.host.root.classList.add('kg-on');
    this.ended = false;
    this.lockUntil = 0;

    const top = el('div', 'kg-top', layer);
    const exit = el('button', 'btn kg-exit', top);
    exit.textContent = '✕';
    exit.addEventListener('click', (e) => {
      e.stopPropagation();
      this.host.click();
      this.stop(true);
    });
    const info = el('div', 'kg-info', top);
    const song = KG_SONGS.find((s) => s.id === this.song)!;
    el('div', 'kg-song', info).textContent = song.title;
    const bar = el('div', 'kg-bar', info);
    this.barEl = el('div', 'kg-fill', bar);
    this.scoreEl = el('div', 'kg-score', top);

    // 點一下模式：點到星星以外的地方算按錯
    layer.addEventListener('pointerdown', (e) => {
      if (this.mode !== 'tap' || this.ended) return;
      if ((e.target as HTMLElement).closest('.kg-top, .kg-result')) return;
      this.press((e.target as HTMLElement).closest('.kg-key') ? 'tap' : 'miss');
    });

    this.host.begin();
    this.hasMusic = this.host.hasSong(song.path) && (await this.host.playSong(song.path, () => this.finish()));
    this.started = performance.now();

    if (this.mode === 'gamepad') {
      const pad = this.findPad();
      if (pad) this.padFam = padFamily(pad.id);
      else this.waitEl = el('div', 'kg-wait', layer);
      if (this.waitEl) this.waitEl.textContent = t('kg.padWait');
    }
    this.round = new KeyRound(this.prompts());
    this.updateScore();
    if (!this.waitEl) this.nextPrompt();
    window.addEventListener('keydown', this.onKey, true);
    this.tick();
  }

  private findPad(): Gamepad | null {
    const pads = navigator.getGamepads?.() ?? [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  private onKey = (e: KeyboardEvent): void => {
    if (!this.layer) return;
    if (e.code === 'Escape') {
      e.preventDefault();
      this.stop(true);
      return;
    }
    if (this.mode !== 'keyboard' || this.ended) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat || isModifier(e.code)) return;
    this.press(keyId(e.code));
  };

  private tick = (): void => {
    if (!this.layer) return;
    // 歌曲進度
    const p = this.hasMusic ? this.host.songProgress() : Math.min(1, (performance.now() - this.started) / 1000 / NO_SONG_TIME);
    if (this.barEl) this.barEl.style.width = `${(p * 100).toFixed(1)}%`;
    if (!this.hasMusic && p >= 1 && !this.ended) this.finish();
    // 控制器：偵測按下的那一瞬間
    if (this.mode === 'gamepad' && !this.ended) {
      const pad = this.findPad();
      if (pad) {
        if (this.waitEl) {
          // 第一次按下按鈕：控制器連上了，開始出題
          this.padFam = padFamily(pad.id);
          this.waitEl.remove();
          this.waitEl = null;
          this.round = new KeyRound(this.prompts());
          this.padPrev = pad.buttons.map((b) => b.pressed);
          this.nextPrompt();
        }
        PAD_BUTTONS.forEach((i) => {
          const now = !!pad.buttons[i]?.pressed;
          if (now && !this.padPrev[i]) this.press(String(i));
          this.padPrev[i] = now;
        });
      }
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  private press(id: string): void {
    const r = this.round;
    if (!r?.current || performance.now() < this.lockUntil) return;
    if (r.press(id)) {
      const p = r.current;
      this.lockUntil = performance.now() + 900;
      this.updateScore();
      this.keyEl?.classList.add('hit');
      if (this.speakOn) this.host.speak(p.speak);
      this.host.cheer(this.mode === 'tap' ? `${p.speak}！` : (p.name ?? p.label));
      const old = this.keyEl;
      window.setTimeout(() => {
        old?.remove();
        if (this.layer && !this.ended) this.nextPrompt();
      }, 650);
    } else {
      // 答錯：題目不換，悅靈懊惱一下
      this.lockUntil = performance.now() + 700;
      this.keyEl?.classList.remove('miss');
      void this.keyEl?.offsetWidth;
      this.keyEl?.classList.add('miss');
      this.host.wrong();
      this.host.oops();
    }
  }

  private nextPrompt(): void {
    if (!this.layer || !this.round) return;
    const p = this.round.next();
    const k = el('div', `kg-key kg-${this.mode === 'gamepad' ? 'pad' : this.mode === 'tap' ? 'tap' : 'cap'}`, this.layer);
    const face = el('div', 'kg-face', k);
    face.textContent = p.label;
    if (p.label.length > 2) face.classList.add('long');
    if (p.color) face.style.setProperty('--pad', p.color);
    if (p.name) el('div', 'kg-name', k).textContent = p.name;
    // 隨機位置，避開中間的悅靈
    // 直立的手機：放在下半部的空地；橫向：放在悅靈的左右兩側
    let x: number;
    let y: number;
    if (window.innerHeight > window.innerWidth * 1.2) {
      x = 22 + Math.random() * 56;
      y = 66 + Math.random() * 18;
    } else {
      x = Math.random() < 0.5 ? 10 + Math.random() * 20 : 70 + Math.random() * 20;
      y = 30 + Math.random() * 44;
    }
    k.style.left = `${x}%`;
    k.style.top = `${y}%`;
    this.keyEl = k;
  }

  private updateScore(): void {
    if (this.scoreEl) this.scoreEl.textContent = t('kg.score', { n: this.round?.score ?? 0 });
  }

  private finish(): void {
    if (!this.layer || this.ended) return;
    this.ended = true;
    this.keyEl?.remove();
    this.waitEl?.remove();
    const score = this.round?.score ?? 0;
    const best = saveBest(localStorage, this.mode, this.song, score);
    this.host.finish(score);
    const res = el('div', 'kg-result', this.layer);
    const box = el('div', 'modal', res);
    el('h2', '', box).textContent = t('kg.title');
    el('div', 'kg-big', box).textContent = t('kg.done', { n: score });
    if (best && score > 0) el('div', 'kg-best', box).textContent = t('kg.newBest');
    if (this.round?.misses) el('div', 'info', box).textContent = t('kg.misses', { n: this.round.misses });
    const row = el('div', 'btnrow', box);
    const again = el('button', 'btn primary', row);
    again.textContent = t('kg.again');
    again.addEventListener('click', () => {
      this.host.click();
      void this.start();
    });
    const menu = el('button', 'btn', row);
    menu.textContent = t('kg.menu');
    menu.addEventListener('click', () => {
      this.host.click();
      this.stop(true);
      this.openMenu();
    });
    const exit = el('button', 'btn', box);
    exit.textContent = t('kg.exit');
    exit.addEventListener('click', () => {
      this.host.click();
      this.stop(true);
    });
  }

  /** 離開遊戲（end = 悅靈恢復自由行動） */
  stop(end: boolean): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey, true);
    if (this.layer) this.host.stopSong();
    this.layer?.remove();
    this.layer = null;
    this.keyEl = null;
    this.waitEl = null;
    this.round = null;
    this.host.root.classList.remove('kg-on');
    if (end) this.host.end();
  }
}
