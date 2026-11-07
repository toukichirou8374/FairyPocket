// 小遊戲的畫面：遊戲選擇 → 精靈舞蹈的選單（玩法、歌曲）→ 遊戲中（題目、分數、歌曲進度）→ 結果。
// 規則在 game/keyGame.ts；貼紙在 game/stickers.ts；悅靈的動作、音樂、鏡頭、麥克風由 main.ts 提供。
//
// 玩法：
//   鍵盤／控制器：按出畫面上的按鍵
//   點一下：點星星（手機測試用）
//   聲音：畫面出現貼紙，大聲說出名字（語音辨識；一陣子沒答對悅靈會提示名字）
//   體感：前鏡頭的畫面當背景，用手揮到悅靈所在的地方，悅靈開心後換地方
// 設定的「開發選項」打開觸碰測試時，所有玩法都可以用點的代替。

import {
  gamepadPrompts,
  isModifier,
  keyboardPrompts,
  keyId,
  KeyRound,
  KG_SONGS,
  loadBest,
  loadDevTap,
  PAD_BUTTONS,
  padFamily,
  saveBest,
  type KeyGameMode,
  type KgSong,
  type Prompt,
  LETTER_SAY,
} from '../game/keyGame';
import { clipKey, demoSpeech, itemFace, itemName, matchesItem, recordedItems, SB_CATS, stickerBookItems, type SbCat, type SbItem } from '../game/sbItems';
import { stickerCanvas } from '../game/stickers';
import type { Clip } from '../voice';
import { getLang, t, type Lang } from '../i18n';
import { Recognizer, speechSupported } from '../speech';
import { anyHeard } from '../sense';

export interface KeyGameHost {
  /** 小遊戲的畫面放在這裡（hud 的根元素） */
  root: HTMLElement;
  click(): void;
  /** 音樂 */
  hasSong(path: string): boolean;
  playSong(path: string, onEnd: () => void): Promise<boolean>;
  stopSong(): void;
  songProgress(): number;
  /** 悅靈：開始（體感玩法不用舞台，改用鏡頭畫面）、答對、答錯、結算、結束 */
  begin(mode: KeyGameMode): void;
  cheer(text: string): void;
  oops(): void;
  finish(score: number): void;
  end(): void;
  /** 念出文字（按鍵名稱、聲音玩法的提示） */
  speak(text: string, lang?: Lang): void;
  /** 悅靈示範發音（用指定語言的裝置內建語音，念得比較慢、比較清楚） */
  demo(text: string, lang: Lang): void;
  /** 悅靈的叫聲（沒有語音檔的回饋先用這個） */
  chirp(): void;
  /** 答錯的聲音 */
  wrong(): void;
  /** 不支援語音辨識時：聽到有人說話就呼叫 onSpeech */
  micStart(onSpeech: () => void): Promise<boolean>;
  micStop(): void;
  /** 體感：開關前鏡頭、悅靈在畫面上的位置（0–1）、那附近在動的比例、讓悅靈換地方 */
  motionStart(): Promise<boolean>;
  motionStop(): void;
  allayScreen(): { x: number; y: number };
  motionActivity(x: number, y: number, r: number): number;
  /** 整個鏡頭畫面在動的比例（離鏡頭太近時會很大） */
  motionOverall(): number;
  moveAllay(): void;
  /** 打開貼紙簿 */
  openStickerBook(): void;
  /** 打開運動場（第一次用到時才下載） */
  openSports(): void;
  /** 貼紙簿的錄音（存檔名 → 錄音） */
  stickerClips(): Promise<Map<string, Clip>>;
  /** 播放貼紙簿的錄音（提示用）；回傳長度（秒） */
  playClip(c: Clip): number;
}

const SPEAK_KEY = 'fairypocket.keygame.speak.v1';
const MODE_KEY = 'fairypocket.keygame.mode.v1';
const VOICE_CATS_KEY = 'fairypocket.keygame.voicecats.v1';
/** 聲音玩法：沒錄音的貼紙也出題（提示時悅靈示範念法） */
const VOICE_DEMO_KEY = 'fairypocket.keygame.voicedemo.v1';

/** 聲音玩法要出哪些類別的貼紙（存在這台裝置） */
function loadVoiceCats(): SbCat[] {
  try {
    const v = JSON.parse(localStorage.getItem(VOICE_CATS_KEY) ?? 'null') as unknown;
    if (Array.isArray(v)) return SB_CATS.filter((c) => v.includes(c));
  } catch {
    // 讀不到就用預設
  }
  return [...SB_CATS];
}
/** 沒有歌的時候玩多久（秒） */
const NO_SONG_TIME = 120;
const SPEECH_LANG: Record<string, string> = { zh_tw: 'zh-TW', ja_jp: 'ja-JP', en_us: 'en-US' };
/** 聲音玩法：出題後多久提示一次名字（毫秒） */
const HINT_FIRST = 3500;
const HINT_EVERY = 6000;
/** 體感：悅靈周圍多大的範圍（畫面寬度的比例）、多少比例在動算碰到 */
const RING = 0.1;
const TOUCH = 0.2;

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
  private noteEl: HTMLElement | null = null;
  private ringEl: HTMLElement | null = null;
  private rotateEl: HTMLElement | null = null;
  /** 這個時間之前不接受按鍵（答對後換題、答錯後懊惱時） */
  private lockUntil = 0;
  private raf = 0;
  private started = 0;
  private hasMusic = false;
  private ended = false;
  private padPrev: boolean[] = [];
  private padFam: ReturnType<typeof padFamily> | null = null;
  private speakOn: boolean;
  /** 開發選項：用點的代替所有輸入 */
  private devTap = false;
  // 聲音玩法
  private rec = new Recognizer();
  private shownAt = 0;
  private nextHint = 0;
  /** 提示念名字時先不聽（避免聽到自己的聲音） */
  private deafUntil = 0;
  /** 聲音玩法的題目：貼紙簿裡錄好的貼紙 */
  private voiceCats = loadVoiceCats();
  private voiceDemo = localStorage.getItem(VOICE_DEMO_KEY) === '1';
  private voiceItems: SbItem[] = [];
  private voiceClips = new Map<string, Clip>();
  // 體感玩法
  private camOk = false;
  private motionReadyAt = 0;
  private touchCount = 0;
  /** 整個畫面在動的比例（平滑過），用來判斷是不是離鏡頭太近 */
  private overall = 0;

  constructor(private host: KeyGameHost) {
    this.speakOn = localStorage.getItem(SPEAK_KEY) !== '0';
    const m = localStorage.getItem(MODE_KEY) as KeyGameMode | null;
    if (m === 'keyboard' || m === 'gamepad' || m === 'tap' || m === 'voice' || m === 'motion') this.mode = m;
    // 玩到一半轉手機（直拿⇄橫拿）：題目照新的方向重新擺，免得跑到畫面外或壓到悅靈
    window.addEventListener('resize', () => {
      if (this.layer && this.keyEl && !this.ended) this.placeInside(this.keyEl, ...this.pickSpot());
    });
  }

  get active(): boolean {
    return !!this.layer;
  }

  // ---------- 遊戲選擇 ----------

  openGames(): void {
    const back = el('div', 'modal-back', this.host.root);
    const box = el('div', 'modal kgmenu', back);
    el('h2', '', box).textContent = t('games');
    el('div', 'info', box).textContent = t('gamesPick');
    const list = el('div', 'kglist', box);
    const games: { id: string; title: string; desc: string; ready: boolean }[] = [
      { id: 'sticker', title: t('game.sticker'), desc: t('sb.short'), ready: true },
      { id: 'dance', title: t('kg.title'), desc: t('kg.short'), ready: true },
      { id: 'sports', title: t('game.sports'), desc: t('sp.short'), ready: true },
    ];
    for (const g of games) {
      const b = el('button', 'btn kggame', list);
      el('span', 'kgname', b).textContent = g.title;
      el('span', 'kgdesc', b).textContent = g.desc;
      b.disabled = !g.ready;
      b.addEventListener('click', () => {
        this.host.click();
        back.remove();
        if (g.id === 'dance') this.openMenu();
        else if (g.id === 'sports') this.host.openSports();
        else this.host.openStickerBook();
      });
    }
    const close = el('button', 'btn', box);
    close.textContent = t('close');
    close.addEventListener('click', () => {
      this.host.click();
      back.remove();
    });
  }

  // ---------- 精靈舞蹈的選單 ----------

  openMenu(): void {
    const back = el('div', 'modal-back', this.host.root);
    const box = el('div', 'modal kgmenu', back);
    box.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.btn')) this.host.click();
    });
    el('h2', '', box).textContent = t('kg.title');
    el('div', 'info', box).textContent = t('kg.desc');

    el('label', '', box).textContent = t('kg.mode');
    const mrow = el('div', 'pgrid', box);
    const modes: KeyGameMode[] = ['keyboard', 'gamepad', 'tap', 'voice', 'motion'];
    const help = el('div', 'info kghelp', box);
    const sp = el('button', 'btn', box);
    // 聲音玩法：選要出哪些類別（只會出貼紙簿裡錄好的）
    const vbox = el('div', 'kgvoice', box);
    el('div', 'info', vbox).textContent = t('kg.voiceCats');
    const vcats = el('div', 'kgcats', vbox);
    const vdemo = el('button', 'btn', vbox);
    vdemo.addEventListener('click', () => {
      this.host.click();
      this.voiceDemo = !this.voiceDemo;
      localStorage.setItem(VOICE_DEMO_KEY, this.voiceDemo ? '1' : '0');
      drawCats();
    });
    const vcount = el('div', 'info', vbox);
    const vbook = el('button', 'btn', vbox);
    vbook.textContent = t('kg.toBook');
    vbook.addEventListener('click', () => {
      back.remove();
      this.host.openStickerBook();
    });
    let keys = new Set<string>();
    const all = stickerBookItems();
    const lang = getLang();
    const drawCats = () => {
      vcats.replaceChildren();
      vdemo.textContent = `${t('kg.voiceDemo')}：${t(this.voiceDemo ? 'on' : 'off')}`;
      vdemo.classList.toggle('on', this.voiceDemo);
      for (const c of SB_CATS) {
        const n = all.filter((it) => it.cat === c && keys.has(clipKey(it, lang))).length;
        const total = all.filter((it) => it.cat === c).length;
        const b = el('button', 'btn small' + (this.voiceCats.includes(c) ? ' on' : ''), vcats);
        b.textContent = this.voiceDemo ? `${t(`sb.cat.${c}`)} ${n}/${total}` : `${t(`sb.cat.${c}`)} ${n}`;
        b.disabled = !this.voiceDemo && n === 0;
        b.addEventListener('click', () => {
          this.voiceCats = this.voiceCats.includes(c) ? this.voiceCats.filter((x) => x !== c) : [...this.voiceCats, c];
          localStorage.setItem(VOICE_CATS_KEY, JSON.stringify(this.voiceCats));
          drawCats();
        });
      }
      const n = this.voicePool(keys, all).length;
      vcount.textContent = n ? t('kg.voiceCount', { n }) : t('kg.voiceNone');
    };
    void this.host.stickerClips().then((m) => {
      keys = new Set(m.keys());
      drawCats();
    });
    drawCats();
    const refresh = () => {
      songs.querySelectorAll<HTMLElement>('.btn').forEach((b) => (b.querySelector('.best')!.textContent = t('kg.best', { n: loadBest(localStorage, this.mode, b.dataset.song as KgSong) })));
      help.textContent = t(`kg.help.${this.mode}`);
      // 念出按鍵只有鍵盤玩法有
      sp.textContent = `${t('kg.speak')}：${t(this.speakOn ? 'on' : 'off')}`;
      sp.classList.toggle('on', this.speakOn);
      sp.style.display = this.mode === 'keyboard' ? '' : 'none';
      vbox.style.display = this.mode === 'voice' ? '' : 'none';
    };
    for (const m of modes) {
      const b = el('button', 'btn' + (m === this.mode ? ' on' : ''), mrow);
      b.textContent = t(`kg.mode.${m}`);
      b.addEventListener('click', () => {
        this.mode = m;
        localStorage.setItem(MODE_KEY, m);
        mrow.querySelectorAll('.btn').forEach((x) => x.classList.toggle('on', x === b));
        refresh();
      });
    }
    // 說明放在玩法按鈕下面
    mrow.after(help);
    help.after(sp);
    sp.after(vbox);
    sp.addEventListener('click', () => {
      this.speakOn = !this.speakOn;
      localStorage.setItem(SPEAK_KEY, this.speakOn ? '1' : '0');
      refresh();
    });

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
    refresh();
    if (!KG_SONGS.some((s) => this.host.hasSong(s.path))) el('div', 'info', box).textContent = t('kg.noSong');
    if (loadDevTap(localStorage)) el('div', 'info kgdev', box).textContent = t('dev.tapOn');

    const row = el('div', 'btnrow', box);
    const go = el('button', 'btn primary', row);
    go.textContent = t('kg.start');
    const close = el('button', 'btn', row);
    close.textContent = t('close');
    close.addEventListener('click', () => back.remove());
    go.addEventListener('click', () => {
      // 聲音玩法沒有錄好的貼紙：先去貼紙簿錄
      if (this.mode === 'voice' && !this.voicePool(keys, all).length) {
        vcount.textContent = t('kg.voiceNone');
        vcount.classList.remove('warn');
        void vcount.offsetWidth;
        vcount.classList.add('warn');
        return;
      }
      back.remove();
      void this.start();
    });
  }

  /** 聲音玩法的題目：選的類別裡錄好的貼紙（打開「沒錄音的也出題」時是全部） */
  private voicePool(keys: Set<string>, all: SbItem[]): SbItem[] {
    if (!this.voiceDemo) return recordedItems(keys, this.voiceCats, getLang(), all);
    return all.filter((it) => this.voiceCats.includes(it.cat));
  }

  // ---------- 遊戲 ----------

  private prompts(): Prompt[] {
    const lang = getLang();
    if (this.mode === 'gamepad') return gamepadPrompts(this.padFam ?? 'playstation', lang);
    if (this.mode === 'tap') return [{ id: 'tap', label: '★', name: t('kg.tapMe'), speak: t('kg.good') }];
    if (this.mode === 'motion') return [{ id: 'motion', label: '', speak: t('kg.good') }];
    if (this.mode === 'voice')
      return this.voiceItems.map((it) => {
        const name = itemName(it, lang);
        const face = it.sticker ? '' : itemFace(it, lang);
        return { id: it.id, label: face, name, speak: name ?? face };
      });
    return keyboardPrompts(lang);
  }

  private async start(): Promise<void> {
    this.stop(false);
    const layer = el('div', `kg kg-${this.mode}`, this.host.root);
    this.layer = layer;
    this.host.root.classList.add('kg-on');
    this.ended = false;
    this.lockUntil = 0;
    this.devTap = loadDevTap(localStorage);

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

    // 點一下玩法（或開發選項的觸碰測試）：點到題目算對，點到別的地方算錯
    layer.addEventListener('pointerdown', (e) => this.onTap(e));

    this.host.begin(this.mode);
    this.hasMusic = this.host.hasSong(song.path) && (await this.host.playSong(song.path, () => this.finish()));
    if (!this.layer) return;
    this.started = performance.now();

    if (this.mode === 'gamepad') {
      const pad = this.findPad();
      if (pad) this.padFam = padFamily(pad.id);
      else if (!this.devTap) {
        this.waitEl = el('div', 'kg-wait', layer);
        this.waitEl.textContent = t('kg.padWait');
      }
    }
    if (this.mode === 'voice') {
      this.voiceClips = await this.host.stickerClips();
      this.voiceItems = this.voicePool(new Set(this.voiceClips.keys()), stickerBookItems());
      await this.startVoice();
    }
    if (this.mode === 'motion') await this.startMotion();
    if (!this.layer) return;
    this.round = new KeyRound(this.prompts());
    this.updateScore();
    if (this.mode === 'motion') this.round.next();
    else if (!this.waitEl) this.nextPrompt();
    window.addEventListener('keydown', this.onKey, true);
    this.tick();
  }

  private note(text: string): void {
    if (!this.layer) return;
    if (!this.noteEl) this.noteEl = el('div', 'kg-note', this.layer);
    this.noteEl.textContent = text;
  }

  private onTap(e: PointerEvent): void {
    if (this.ended || !this.round) return;
    const target = e.target as HTMLElement;
    if (target.closest('.kg-top, .kg-result')) return;
    if (this.mode !== 'tap' && !this.devTap) return;
    if (this.mode === 'motion') {
      // 點到悅靈附近算碰到
      const a = this.host.allayScreen();
      const d = Math.hypot(e.clientX - a.x * window.innerWidth, e.clientY - a.y * window.innerHeight);
      if (d < RING * window.innerWidth * 1.3) this.motionTouched();
      return;
    }
    if (this.mode === 'gamepad' && this.waitEl) return;
    this.press(target.closest('.kg-key') ? this.round.current!.id : 'miss');
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

  // ---------- 聲音 ----------

  private async startVoice(): Promise<void> {
    const onHeard = (text: string, final: boolean, alts: string[]) => {
      const cur = this.round?.current;
      if (!cur || this.ended || performance.now() < this.deafUntil) return;
      const it = this.voiceItems.find((x) => x.id === cur.id);
      if (it && anyHeard(alts.length ? alts : [text], (a) => matchesItem(a, it, getLang()))) this.press(cur.id);
      // 聽到的不是答案：不算錯（可能是旁邊的人、電視或悅靈自己的聲音），告訴小朋友聽到什麼
      else if (final && text.trim()) this.note(t('kg.voiceHeard', { w: text.trim().slice(0, 12) }));
    };
    // 麥克風不能用：開發選項的觸碰測試打開時改用點的
    const fail = () => this.note(this.devTap ? t('kg.voiceTapOnly') : t('micDenied'));
    if (speechSupported() && this.rec.start(SPEECH_LANG[getLang()], onHeard, fail)) {
      this.note(t('kg.voiceSay'));
      return;
    }
    // 不支援語音辨識：聽到說話的聲音就算答對
    const ok = await this.host.micStart(() => {
      const cur = this.round?.current;
      if (cur && performance.now() >= this.deafUntil) this.press(cur.id);
    });
    this.note(ok ? t('kg.voiceAny') : this.devTap ? t('kg.voiceTapOnly') : t('micDenied'));
  }

  // ---------- 體感 ----------

  private async startMotion(): Promise<void> {
    this.camOk = await this.host.motionStart();
    if (!this.layer) return;
    if (!this.camOk) this.note(this.devTap ? t('kg.noCamTap') : t('kg.noCam'));
    else this.note(t('kg.motionSay'));
    this.ringEl = el('div', 'kg-ring', this.layer);
    this.rotateEl = el('div', 'kg-rotate', this.layer);
    this.rotateEl.textContent = t('kg.rotate');
    this.host.moveAllay();
    this.motionReadyAt = performance.now() + 1500;
  }

  private motionTouched(): void {
    if (!this.round || performance.now() < this.motionReadyAt) return;
    this.round.press('motion');
    this.updateScore();
    this.host.chirp();
    this.host.cheer(t('kg.good') + '！');
    this.ringEl?.classList.add('hit');
    this.motionReadyAt = performance.now() + 2600;
    this.touchCount = 0;
    window.setTimeout(() => {
      if (!this.layer || this.ended) return;
      this.ringEl?.classList.remove('hit');
      this.host.moveAllay();
    }, 1100);
  }

  private tickMotion(now: number): void {
    const a = this.host.allayScreen();
    const W = window.innerWidth;
    if (this.ringEl) {
      this.ringEl.style.left = `${a.x * 100}%`;
      this.ringEl.style.top = `${a.y * 100}%`;
      this.ringEl.style.width = this.ringEl.style.height = `${RING * 2 * W}px`;
      this.ringEl.classList.toggle('wait', now < this.motionReadyAt);
    }
    // 提示：直著拿（畫面比較高）時請橫放；整個畫面一直在動（離鏡頭太近）時請往後退
    if (this.camOk) this.overall += (this.host.motionOverall() - this.overall) * 0.08;
    const portrait = window.innerHeight > W;
    const tooClose = this.camOk && this.overall > 0.3;
    if (this.rotateEl) {
      this.rotateEl.style.display = portrait || tooClose ? '' : 'none';
      this.rotateEl.textContent = portrait ? t('kg.rotate') : t('kg.tooClose');
    }
    if (!this.camOk || now < this.motionReadyAt) return;
    const act = this.host.motionActivity(a.x, a.y, RING);
    this.touchCount = act > TOUCH ? this.touchCount + 1 : 0;
    // 連續兩次（約 0.2 秒）都有動才算，避免雜訊
    if (this.touchCount >= 2) this.motionTouched();
  }

  private tick = (): void => {
    if (!this.layer) return;
    const now = performance.now();
    // 歌曲進度
    const p = this.hasMusic ? this.host.songProgress() : Math.min(1, (now - this.started) / 1000 / NO_SONG_TIME);
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
          const down = !!pad.buttons[i]?.pressed;
          if (down && !this.padPrev[i]) this.press(String(i));
          this.padPrev[i] = down;
        });
      }
    }
    // 聲音：一陣子沒答對，悅靈提示名字
    if (this.mode === 'voice' && !this.ended && this.round?.current && now > this.lockUntil && now - this.shownAt > this.nextHint) {
      this.nextHint += HINT_EVERY;
      // 提示：播放貼紙簿裡錄的聲音（播放時先不聽）
      const it = this.voiceItems.find((x) => x.id === this.round?.current?.id);
      const clip = it && this.voiceClips.get(clipKey(it, getLang()));
      if (clip) this.deafUntil = now + this.host.playClip(clip) * 1000 + 600;
      else if (it) {
        // 沒有錄音：悅靈示範念法
        this.deafUntil = now + 2600;
        const d = demoSpeech(it, getLang());
        this.host.demo(d.text, d.lang);
      }
      this.keyEl?.classList.remove('hint');
      void this.keyEl?.offsetWidth;
      this.keyEl?.classList.add('hint');
    }
    if (this.mode === 'motion' && !this.ended) this.tickMotion(now);
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
      // 鍵盤念出按鍵；其他玩法先用悅靈的叫聲
      // 英文字母一律用英文的念法
      if (this.mode === 'keyboard' && this.speakOn) {
        if (LETTER_SAY[p.label]) this.host.speak(LETTER_SAY[p.label], 'en_us');
        else this.host.speak(p.speak);
      }
      else this.host.chirp();
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
    const kind = this.mode === 'gamepad' ? 'pad' : this.mode === 'tap' ? 'tap' : this.mode === 'voice' ? 'sticker' : 'cap';
    const k = el('div', `kg-key kg-${kind}${this.mode === 'gamepad' && (this.padFam ?? 'playstation') === 'playstation' ? ' ps' : ''}`, this.layer);
    const face = el('div', 'kg-face', k);
    const vit = this.mode === 'voice' ? this.voiceItems.find((x) => x.id === p.id) : undefined;
    if (vit?.sticker) face.appendChild(stickerCanvas(vit.sticker, 8));
    else face.textContent = p.label;
    if (p.label.length > 2) face.classList.add('long');
    else if (this.mode === 'voice' && p.label.length === 2) face.classList.add('mid');
    if (p.color) face.style.setProperty('--pad', p.color);
    if (p.name) el('div', 'kg-name', k).textContent = p.name;
    // 隨機位置，避開中間的悅靈
    // 直立的手機：放在下半部的空地；橫向：放在悅靈的左右兩側
    this.placeInside(k, ...this.pickSpot());
    this.keyEl = k;
    this.shownAt = performance.now();
    this.nextHint = HINT_FIRST;
  }

  /** 題目的隨機位置 (x%, y%)：直立放下半部，橫向放悅靈左右兩側 */
  private pickSpot(): [number, number] {
    if (window.innerHeight > window.innerWidth * 1.2) return [22 + Math.random() * 56, 66 + Math.random() * 18];
    return [Math.random() < 0.5 ? 10 + Math.random() * 20 : 70 + Math.random() * 20, 30 + Math.random() * 44];
  }

  /** 把題目放在 (x%, y%)，但整個題目（含名字）不能超出畫面、不能壓到上面的分數列與下面的說明 */
  private placeInside(k: HTMLElement, x: number, y: number): void {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const w = k.offsetWidth;
    const h = k.offsetHeight;
    const topBar = this.layer?.querySelector('.kg-top')?.getBoundingClientRect().bottom ?? 60;
    const top = topBar + 8;
    const bottom = H - (this.noteEl ? this.noteEl.offsetHeight + 22 : 10);
    const cx = Math.min(Math.max((x / 100) * W, w / 2 + 8), W - w / 2 - 8);
    const cy = bottom - top < h ? (top + bottom) / 2 : Math.min(Math.max((y / 100) * H, top + h / 2), bottom - h / 2);
    k.style.left = `${cx}px`;
    k.style.top = `${cy}px`;
  }

  private updateScore(): void {
    if (this.scoreEl) this.scoreEl.textContent = t('kg.score', { n: this.round?.score ?? 0 });
  }

  private finish(): void {
    if (!this.layer || this.ended) return;
    this.ended = true;
    this.keyEl?.remove();
    this.waitEl?.remove();
    this.ringEl?.remove();
    this.rec.stop();
    this.host.micStop();
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
    this.rec.stop();
    this.host.micStop();
    this.host.motionStop();
    if (this.layer) this.host.stopSong();
    this.layer?.remove();
    this.layer = null;
    this.keyEl = null;
    this.waitEl = null;
    this.noteEl = null;
    this.ringEl = null;
    this.rotateEl = null;
    this.round = null;
    this.camOk = false;
    this.host.root.classList.remove('kg-on');
    if (end) this.host.end();
  }
}
