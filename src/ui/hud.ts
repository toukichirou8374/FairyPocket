// 畫面上的 HTML 介面：名字、對話泡泡、愛心 / 飽食度、快捷欄、設定與開場。

import { foodIcon, gridURL, HEART, HEART_PAL, ITEM_ICONS, SHANK, SHANK_PAL, statGrid } from '../pixel';
import { affectionLevel, BEDTIMES, FOOD_IDS, moodLevel, NAME_MAX, wakeHour, type Bedtime, PERSONALITY_COLOR, PERSONALITY_IDS, toIcons, type Food, type Personality, type PetState } from '../game/state';
import type { AssetImages } from '../game/assets';
import { VOLUME_KINDS, type SoundMode, type VolumeKind, type Volumes } from '../audio';
import { BIOMES, type Biome } from '../three/biome';
import type { Pose } from '../three/allayController';
import { getLang, itemName, LANGS, personalityText, t, type Lang, type UiKey } from '../i18n';
import { loadDevTap, saveDevTap } from '../game/keyGame';
import { bedIso, chestIso, isoCube } from './isoIcon';
import { VOICE_STYLES, type VoiceStyle } from '../voicefx';
import { voiceLabel, type VoiceInfo } from '../ttsVoice';

/** 素材包：新版 zip、舊版 json 都可以 */
const PACK_ACCEPT = '.zip,application/zip,application/x-zip-compressed,.json,application/json';

export type Slot = 'food' | 'feather' | 'slime' | 'note' | 'jukebox' | 'live' | 'mic' | 'wave' | 'bed' | 'firework' | 'bath' | 'call';
export const SLOTS: Slot[] = ['food', 'feather', 'slime', 'note', 'jukebox', 'live', 'mic', 'wave', 'bed', 'firework', 'bath', 'call'];

/** 快捷欄的 5 個分類格：點一下拿起這一類上次用的東西，再點一下打開選單換別的 */
export type Group = 'food' | 'toys' | 'blocks' | 'sense' | 'call';
export const GROUPS: { id: Group; tools: Slot[] }[] = [
  { id: 'food', tools: ['food'] },
  { id: 'toys', tools: ['feather', 'slime', 'firework', 'bath'] },
  { id: 'blocks', tools: ['note', 'jukebox', 'bed'] },
  { id: 'sense', tools: ['live', 'mic', 'wave'] },
  { id: 'call', tools: ['call'] },
];
const groupOf = (t: Slot) => GROUPS.find((g) => g.tools.includes(t))!;

const TOOL_ICON: Record<Slot, string> = {
  food: 'chest', feather: 'feather', slime: 'slime', note: 'noteblock', jukebox: 'jukebox', live: 'eye', mic: 'mic', wave: 'hand', bed: 'bed', firework: 'firework', bath: 'bucket', call: 'bell',
};

/** 快捷欄名稱（Java 版譯名）與操作提示 */
function slotText(s: Slot): { label: string; hint: string } {
  switch (s) {
    case 'food': return { label: itemName('inventory'), hint: t('hint.food') };
    case 'feather': return { label: itemName('feather'), hint: t('hint.feather') };
    case 'slime': return { label: itemName('slime_ball'), hint: t('hint.slime') };
    case 'note': return { label: itemName('note_block'), hint: t('hint.note') };
    case 'jukebox': return { label: itemName('jukebox'), hint: t('hint.jukebox') };
    case 'live': return { label: t('liveSlot'), hint: t('hint.live') };
    case 'mic': return { label: t('mic'), hint: t('hint.mic') };
    case 'wave': return { label: t('waveSlot'), hint: t('hint.wave') };
    case 'bed': return { label: itemName('bed'), hint: t('hint.bed') };
    case 'firework': return { label: itemName('firework'), hint: t('hint.firework') };
    case 'bath': return { label: itemName('water_bucket'), hint: t('hint.bath') };
    case 'call': return { label: t('call'), hint: '' };
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  parent?.appendChild(e);
  return e;
}

export interface HudActions {
  select(slot: Slot | null): void;
  call(): void;
  rename(name: string): void;
  setPersonality(p: Personality): void;
  setLang(l: Lang): void;
  glow(): boolean;
  bedtime(): Bedtime;
  /** 相機 AR 模式 */
  arOpen(): void;
  arClose(): void;
  arPhoto(): void;
  arRecord(): void;
  arFlip(): void;
  /** 打開小遊戲選單 */
  games(): void;
  /** 設定頁錄的回應（目前語言 5 句）：哪幾格有錄、錄音、試聽、刪除 */
  replies(): boolean[];
  recordReply(i: number): Promise<{ stop: () => void; done: Promise<boolean> } | null>;
  playReply(i: number): void;
  deleteReply(i: number): void;
  /** 回應的變聲種類 */
  voiceStyle(): VoiceStyle;
  /** 說話的聲音（裝置內建語音）：目前語言可以用的、選了哪個（'' = 自動）、改選（會念一句試聽） */
  ttsVoices(): VoiceInfo[];
  ttsVoice(): string;
  setTtsVoice(uri: string): void;
  setVoiceStyle(v: VoiceStyle): void;
  /** AR 攝影棚：換姿勢、轉向（turn）、讓悅靈自己行動（free） */
  arPose(p: Pose | 'turn' | 'free'): void;
  biome(): Biome;
  setBiome(b: Biome): void;
  setBedtime(b: Bedtime): void;
  setGlow(on: boolean): void;
  exportSave(): void;
  importSave(file: File): void;
  shareLink(): void;
  pasteLink(): void;
  reset(): void;
  onboard(name: string, p: Personality): void;
  importAssets(file: File): void;
  clearAssets(): void | Promise<void>;
  /** 已套用的原版素材版本，未套用時為 null */
  assetSource(): string | null;
  soundMode(): SoundMode;
  setSoundMode(m: SoundMode): void;
  /** 素材包裡有沒有音效 */
  soundAvailable(): boolean;
  /** 背景音樂 */
  /** 音量：各分類 0–1 與全部靜音 */
  volumes(): { vol: Volumes; muted: boolean };
  setVolume(k: VolumeKind, v: number): void;
  previewVolume(k: VolumeKind): void;
  setMuted(on: boolean): void;
  musicAvailable(): boolean;
  /** 介面音效：按鈕、打開／關上物品欄 */
  sfx(e: 'click' | 'open' | 'close'): void;
}

export class Hud {
  readonly nameTag: HTMLDivElement;
  readonly bubble: HTMLDivElement;
  private hearts: HTMLImageElement[] = [];
  private shanks: HTMLImageElement[] = [];
  private slots: HTMLButtonElement[] = [];
  private itemName: HTMLDivElement;
  private toastEl: HTMLDivElement;
  private toastTimer = 0;
  private bubbleTimer = 0;
  private itemTimer = 0;
  private heartURL: string[];
  private shankURL: string[];
  selected: Slot | null = null;
  /** 從背包選好、準備丟出去的食物 */
  food: Food | null = null;
  private foodURL = {} as Record<Food, string>;
  private foodBadge!: HTMLImageElement;
  private recBtn!: HTMLButtonElement;
  private poseBar!: HTMLDivElement;
  private shardBadge!: HTMLImageElement;
  private chargeEl!: HTMLDivElement;
  private lastStat = '';
  private bar!: HTMLDivElement;
  private selFrame!: HTMLDivElement;
  private mc: { img: HTMLImageElement; cols: number; selW: number; selH: number } | null = null;

  constructor(private root: HTMLElement, private actions: HudActions) {
    this.nameTag = el('div', 'nametag', root);
    this.bubble = el('div', 'bubble', root);

    // 0=空 1=半 2=滿
    this.heartURL = [0, 1, 2].map((l) => gridURL(statGrid(HEART, l, 4, false), HEART_PAL));
    this.shankURL = [0, 1, 2].map((l) => gridURL(statGrid(SHANK, l, 4, true), SHANK_PAL));

    const gear = el('button', 'gear', root);
    this.gearBtn = gear;
    gear.setAttribute('aria-label', t('settings'));
    gear.textContent = '⚙';
    gear.addEventListener('click', () => {
      this.actions.sfx('click');
      this.openSettings();
    });

    // 小遊戲（書本，在設定按鈕旁邊）
    const book = el('button', 'gear book', root);
    book.setAttribute('aria-label', t('games'));
    this.bookImg = el('img', '', book);
    this.bookImg.alt = '';
    book.addEventListener('click', () => {
      this.actions.sfx('click');
      this.actions.games();
    });

    // 相機 AR 模式的按鈕（左上）與 AR 工具列（右側）
    const cam = el('button', 'gear camera', root);
    cam.setAttribute('aria-label', t('ar'));
    this.camImg = el('img', '', cam);
    this.camImg.src = gridURL(ITEM_ICONS.camera.grid, ITEM_ICONS.camera.pal, 3);
    cam.addEventListener('click', () => {
      this.actions.sfx('click');
      this.actions.arOpen();
    });
    const tools = el('div', 'artools', root);
    const tool = (cls: string, label: string, fn: () => void) => {
      const b = el('button', 'artool ' + cls, tools);
      b.setAttribute('aria-label', label);
      b.addEventListener('click', fn);
      return b;
    };
    tool('shutter', t('arPhoto'), () => this.actions.arPhoto());
    this.recBtn = tool('record', t('arRecord'), () => this.actions.arRecord());
    tool('flip', t('arFlip'), () => this.actions.arFlip()).textContent = '⇄';
    // 動作：按了才展開姿勢清單；沒選姿勢時悅靈照常自由行動
    tool('posebtn', t('arPoses'), () => root.classList.toggle('poseopen')).textContent = t('arPoses');
    const poses = el('div', 'posebar', root);
    const POSES: (Pose | 'turn' | 'free')[] = ['fly', 'wave', 'dance', 'happy', 'hold', 'sleep', 'turn', 'free'];
    for (const p of POSES) {
      const b = el('button', 'btn pose', poses);
      b.dataset.pose = p;
      b.textContent = t(`pose.${p}` as UiKey);
      b.addEventListener('click', () => {
        this.actions.sfx('click');
        if (p !== 'turn') poses.querySelectorAll('.pose').forEach((x) => x.classList.toggle('on', x === b && p !== 'free'));
        this.actions.arPose(p);
      });
    }
    this.poseBar = poses;
    tool('exit', t('close'), () => this.actions.arClose()).textContent = '✕';

    const hud = el('div', 'hud', root);
    this.itemName = el('div', 'itemname', hud);
    const stats = el('div', 'stats', hud);
    const hrow = el('div', 'statrow', stats);
    const srow = el('div', 'statrow right', stats);
    for (let i = 0; i < 10; i++) {
      this.hearts.push(el('img', 'icon', hrow));
      this.shanks.unshift(el('img', 'icon', srow)); // 飽食度由右往左排列
    }
    const bar = el('div', 'hotbar', hud);
    this.bar = bar;
    this.selFrame = el('div', 'selframe', bar);
    for (const f of FOOD_IDS) this.foodURL[f] = foodIcon(f, 4).toDataURL();
    for (const t of SLOTS) this.toolURL[t] = gridURL(ITEM_ICONS[TOOL_ICON[t]].grid, ITEM_ICONS[TOOL_ICON[t]].pal, 4);
    GROUPS.forEach((g) => {
      const b = el('button', 'slot', bar);
      b.dataset.slot = g.id;
      this.slots.push(b);
      const img = el('img', '', b);
      img.src = this.toolURL[this.current[g.id]];
      b.setAttribute('aria-label', g.id === 'food' || g.id === 'call' ? slotText(g.tools[0]).label : t(`group.${g.id}`));
      if (g.id === 'food') {
        this.foodBadge = el('img', 'badge', b);
        this.foodBadge.hidden = true;
      }
      if (g.id === 'blocks') {
        // 悅靈跳舞時，方塊格右下角出現紫水晶碎片
        this.shardBadge = el('img', 'badge', b);
        this.shardBadge.src = gridURL(ITEM_ICONS.amethyst.grid, ITEM_ICONS.amethyst.pal, 4);
        this.shardBadge.hidden = true;
      }
      b.addEventListener('click', () => {
        if (g.id === 'call') {
          this.showItem(slotText('call').label);
          this.actions.call();
          return;
        }
        const holding = this.selected && groupOf(this.selected).id === g.id;
        if (g.id === 'food') {
          // 還沒選過食物、或已經拿著食物：打開物品欄
          if (holding || !this.food) return this.openBag();
          this.actions.sfx('click');
          return this.setSelected('food');
        }
        if (holding) return this.openMenu(g.id);
        this.actions.sfx('click');
        this.setSelected(this.current[g.id]);
      });
    });
    this.chargeEl = el('div', 'charge', hud);
    el('div', '', this.chargeEl);
    this.toastEl = el('div', 'toast', root);
  }

  /** 每個分類上次拿的東西 */
  private current: Record<Group, Slot> = { food: 'food', toys: 'feather', blocks: 'note', sense: 'mic', call: 'call' };
  private toolURL = {} as Record<Slot, string>;
  private gearBtn!: HTMLButtonElement;
  private camImg!: HTMLImageElement;
  private bookImg!: HTMLImageElement;

  setSelected(slot: Slot | null): void {
    this.selected = slot;
    if (slot) {
      const g = groupOf(slot);
      this.current[g.id] = slot;
      const b = this.slots.find((x) => x.dataset.slot === g.id);
      if (b) b.querySelector('img')!.src = this.toolURL[slot];
    }
    const sel = slot ? groupOf(slot).id : null;
    this.slots.forEach((b) => b.classList.toggle('selected', b.dataset.slot === sel));
    this.layout();
    if (slot) {
      const s = slotText(slot);
      this.showItem(`${slot === 'food' && this.food ? itemName(this.food) : s.label}　${slot === 'food' && this.food === 'cake' ? t('hint.cake') : s.hint}`);
    }
    this.actions.select(slot);
  }

  /** AR 模式開關：顯示相機工具列、藏起相機按鈕 */
  setAr(on: boolean): void {
    this.root.classList.toggle('ar', on);
    // 進出 AR 都恢復自由行動、收起動作清單
    this.root.classList.remove('poseopen');
    this.poseBar.querySelectorAll('.pose').forEach((x) => x.classList.remove('on'));
    document.body.classList.toggle('ar', on);
  }

  setRecording(on: boolean): void {
    this.recBtn.classList.toggle('on', on);
  }

  /** 悅靈正在跳舞：可以給牠紫水晶碎片 */
  setShardReady(on: boolean): void {
    if (this.shardBadge.hidden !== on) return;
    this.shardBadge.hidden = !on;
    if (on && this.selected === 'note') this.showItem(`${itemName('amethyst_shard')}　${t('shardReady')}`);
  }

  /** 史萊姆球蓄力條；null 代表隱藏 */
  setCharge(v: number | null): void {
    this.chargeEl.classList.toggle('show', v !== null);
    if (v !== null) (this.chargeEl.firstChild as HTMLDivElement).style.width = `${Math.round(v * 100)}%`;
  }

  /** 分類選單：像物品欄一樣的格子，選一樣拿起來；「收起」就什麼都不拿 */
  private openMenu(g: Group): void {
    this.actions.sfx('open');
    const { box, close: hide } = this.modal(t(`group.${g}` as UiKey));
    const close = () => {
      this.actions.sfx('close');
      hide();
    };
    box.classList.add('bag');
    const name = el('div', 'bagname', box);
    name.textContent = this.selected ? slotText(this.selected).label : '';
    const grid = el('div', 'baggrid', box);
    for (const tool of GROUPS.find((x) => x.id === g)!.tools) {
      const b = el('button', 'bagslot' + (tool === this.selected ? ' on' : ''), grid);
      b.dataset.tool = tool;
      b.setAttribute('aria-label', slotText(tool).label);
      el('img', '', b).src = this.toolURL[tool];
      b.addEventListener('click', () => {
        close();
        this.setSelected(tool);
      });
    }
    const row = el('div', 'btnrow', box);
    const put = el('button', 'btn', row);
    put.textContent = t('putAway');
    put.addEventListener('click', () => {
      close();
      this.setSelected(null);
    });
    const cancel = el('button', 'btn', row);
    cancel.textContent = t('close');
    cancel.addEventListener('click', close);
  }

  /** 背包：選一種食物，選好後就可以丟給悅靈 */
  private openBag(): void {
    this.actions.sfx('open');
    const { box, close: hide } = this.modal(itemName('inventory'));
    const close = () => {
      this.actions.sfx('close');
      hide();
    };
    box.classList.add('bag');
    const name = el('div', 'bagname', box);
    name.textContent = this.food ? itemName(this.food) : t('bagEmpty');
    const grid = el('div', 'baggrid', box);
    for (const f of FOOD_IDS) {
      const b = el('button', 'bagslot' + (f === this.food ? ' on' : ''), grid);
      b.dataset.food = f;
      b.setAttribute('aria-label', itemName(f));
      el('img', '', b).src = this.foodURL[f];
      b.addEventListener('click', () => {
        this.food = f;
        this.foodBadge.src = this.foodURL[f];
        this.foodBadge.hidden = false;
        close();
        this.setSelected('food');
      });
    }
    const cancel = el('button', 'btn', box);
    cancel.textContent = t('close');
    cancel.addEventListener('click', close);
  }

  /** 套用原版食物圖示 */
  useFoodImages(img: Partial<Record<Food, HTMLImageElement>>): void {
    for (const [f, src] of Object.entries(img) as [Food, HTMLImageElement][]) this.foodURL[f] = src.src;
    if (this.food) this.foodBadge.src = this.foodURL[this.food];
  }

  showItem(text: string): void {
    this.itemName.textContent = text;
    this.itemName.classList.add('show');
    clearTimeout(this.itemTimer);
    this.itemTimer = window.setTimeout(() => this.itemName.classList.remove('show'), 1800);
  }

  /** 套用 Minecraft 原版介面素材 */
  useImages(img: AssetImages): void {
    const canvas = (w: number, h: number) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return { c, ctx: c.getContext('2d')! };
    };
    const layered = (base?: HTMLImageElement, top?: HTMLImageElement) => {
      const { c, ctx } = canvas(9, 9);
      if (base) ctx.drawImage(base, 0, 0);
      if (top) ctx.drawImage(top, 0, 0);
      return c.toDataURL();
    };
    if (img.heart_container && img.heart_full && img.heart_half) {
      this.heartURL = [layered(img.heart_container), layered(img.heart_container, img.heart_half), layered(img.heart_container, img.heart_full)];
    }
    if (img.food_empty && img.food_full && img.food_half) {
      this.shankURL = [layered(img.food_empty), layered(img.food_empty, img.food_half), layered(img.food_empty, img.food_full)];
    }
    this.lastStat = '';

    const items: Record<Slot, string | undefined> = {
      // 方塊類用原版物品欄那樣的斜角立體圖示
      food: img.chest && chestIso(img.chest),
      feather: img.feather?.src,
      slime: img.slime_ball?.src,
      note: img.note_block && isoCube(img.note_block),
      jukebox: img.jukebox_top && img.jukebox_side && isoCube(img.jukebox_top, img.jukebox_side),
      live: undefined,
      mic: undefined,
      wave: undefined,
      bed:
        img.bed_head_up && img.bed_foot_up && img.bed_head_east && img.bed_foot_east && img.bed_foot_south
          ? bedIso({ head_up: img.bed_head_up, foot_up: img.bed_foot_up, head_side: img.bed_head_east, foot_side: img.bed_foot_east, foot_end: img.bed_foot_south })
          : undefined,
      firework: img.firework_rocket?.src, bath: img.water_bucket?.src, call: img.bell?.src,
    };
    for (const tool of SLOTS) if (items[tool]) this.toolURL[tool] = items[tool]!;
    // 設定按鈕用工作台、相機按鈕用望遠鏡
    if (img.crafting_table_top && img.crafting_table_front && img.crafting_table_side) {
      this.gearBtn.textContent = '';
      this.gearBtn.classList.add('icon');
      el('img', '', this.gearBtn).src = isoCube(img.crafting_table_top, img.crafting_table_front, img.crafting_table_side);
    }
    if (img.spyglass) this.camImg.src = img.spyglass.src;
    if (img.book) this.bookImg.src = img.book.src;
    this.slots.forEach((b) => {
      b.querySelector('img')!.src = this.toolURL[this.current[b.dataset.slot as Group]];
    });
    if (img.amethyst_shard) this.shardBadge.src = img.amethyst_shard.src;
    // 設定畫面的按鈕、輸入框用原版九宮格材質
    const r = this.root.style;
    if (img.button && img.button_highlighted) {
      r.setProperty('--btn', `url(${img.button.src})`);
      r.setProperty('--btn-on', `url(${img.button_highlighted.src})`);
      this.root.classList.add('mcgui');
    }
    if (img.text_field && img.text_field_highlighted) {
      r.setProperty('--field', `url(${img.text_field.src})`);
      r.setProperty('--field-on', `url(${img.text_field_highlighted.src})`);
    }

    if (img.hotbar && img.hotbar_selection) {
      this.selFrame.style.backgroundImage = `url(${img.hotbar_selection.src})`;
      this.mc = { img: img.hotbar, cols: 0, selW: img.hotbar_selection.width, selH: img.hotbar_selection.height };
      this.root.classList.add('mc');
      window.addEventListener('resize', () => this.layout());
      this.layout();
    }
  }

  /** 原版模式下依螢幕寬度以整數倍放大像素介面 */
  /** 用原版快捷欄材質拼出 cols 格（原版 9 格，每格 20 像素，左右各 1 像素邊框） */
  private barImage(cols: number): string {
    const src = this.mc!.img;
    const k = src.width / 182;
    const c = document.createElement('canvas');
    c.width = 2 + cols * 20;
    c.height = 22;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0, k, src.height, 0, 0, 1, 22);
    for (let j = 0; j < cols; j++) ctx.drawImage(src, (1 + (j % 9) * 20) * k, 0, 20 * k, src.height, 1 + j * 20, 0, 20, 22);
    ctx.drawImage(src, src.width - k, 0, k, src.height, c.width - 1, 0, 1, 22);
    return c.toDataURL();
  }

  /**
   * 原版模式下依螢幕大小以整數（0.5 倍為單位）放大像素介面。
   * 10 格排成一排太小時（直拿手機），改成上下兩排、每排 5 格；格子至少約 50px 好點。
   */
  private layout(): void {
    if (!this.mc) return;
    const w = window.innerWidth - 24, h = window.innerHeight * 0.9;
    const fit = (cols: number, cap: number) => Math.min(w, cap, h) / (2 + cols * 20);
    // 橫拿手機時寬度夠就排成一排（比較不佔畫面高度）
    const n = GROUPS.length;
    const cols = Math.min(w, 680) / (2 + n * 20) >= 2.5 ? n : Math.ceil(n / 2);
    const rows = Math.ceil(n / cols);
    // 最大寬度 330px：iPhone 直拿時每格約 60px，不會太大
    const s = Math.max(2.5, Math.floor(fit(cols, 330) * 2) / 2);
    if (cols !== this.mc.cols) {
      this.mc.cols = cols;
      this.bar.style.backgroundImage = `url(${this.barImage(cols)})`;
    }
    const barW = 2 + cols * 20;
    const r = this.root.style;
    r.setProperty('--s', `${s}px`);
    r.setProperty('--u', `${(barW * s - 8) / 162}px`);
    this.bar.style.width = `${barW * s}px`;
    this.bar.style.height = `${rows * 22 * s}px`;
    this.bar.style.backgroundSize = `100% ${100 / rows}%`;
    this.slots.forEach((b, i) => {
      b.style.left = `${(1 + (i % cols) * 20) * s}px`;
      b.style.top = `${(1 + Math.floor(i / cols) * 22) * s}px`;
    });
    const i = this.selected ? GROUPS.indexOf(groupOf(this.selected)) : -1;
    this.selFrame.style.display = i < 0 ? 'none' : 'block';
    this.selFrame.style.left = `${((i % cols) * 20 - 1) * s}px`;
    this.selFrame.style.top = `${(Math.floor(i / cols) * 22 - 1) * s}px`;
    this.selFrame.style.width = `${this.mc.selW * s}px`;
    this.selFrame.style.height = `${this.mc.selH * s}px`;
  }

  updateStats(s: PetState): void {
    const h = toIcons(s.health);
    const f = toIcons(s.hunger);
    const key = h.join('') + f.join('');
    if (key === this.lastStat) return;
    this.lastStat = key;
    h.forEach((l, i) => (this.hearts[i].src = this.heartURL[l]));
    f.forEach((l, i) => (this.shanks[i].src = this.shankURL[l]));
  }

  say(text: string): void {
    this.bubble.textContent = text;
    this.bubble.classList.add('show');
    clearTimeout(this.bubbleTimer);
    this.bubbleTimer = window.setTimeout(() => this.bubble.classList.remove('show'), 3200);
  }

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 2400);
  }

  // ---------- 匯入進度（像原版的載入畫面：文字 + 進度條 + 一直往上跑的百分比） ----------

  private prog: { back: HTMLDivElement; label: HTMLDivElement; fill: HTMLDivElement; pct: HTMLDivElement; foot: HTMLDivElement } | null = null;
  private progShown = 0;
  private progAt = 0;
  private progNext = 0;
  private progRaf = 0;
  private progTimer = 0;

  /**
   * 顯示或更新進度：at = 目前已完成的比例，next = 這一步做完會到的比例。
   * 等待中的百分比會慢慢往 next 靠近（不會停住），讓人知道還在跑。
   */
  progress(label: string, at: number, next = at): void {
    if (!this.prog) {
      const back = el('div', 'progress-back', this.root);
      const box = el('div', 'progress', back);
      const lbl = el('div', 'plabel', box);
      const bar = el('div', 'pbar', box);
      const fill = el('div', 'pfill', bar);
      const pct = el('div', 'ppct', box);
      const foot = el('div', 'pfoot', box);
      this.prog = { back, label: lbl, fill, pct, foot };
      this.progShown = 0;
    }
    clearTimeout(this.progTimer);
    this.prog.back.classList.remove('done', 'fail');
    this.prog.foot.replaceChildren();
    this.prog.label.textContent = label;
    this.progAt = Math.max(this.progShown, at);
    this.progNext = Math.max(this.progAt, next);
    if (!this.progRaf) {
      let last = performance.now();
      const tick = (now: number) => {
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        // 先追上已完成的部分，再朝下一個目標慢慢逼近（只走剩下距離的一小部分，永遠不會超過）
        if (this.progShown < this.progAt) this.progShown = Math.min(this.progAt, this.progShown + dt * 0.8);
        else this.progShown += (this.progNext - this.progShown) * (1 - Math.exp(-dt * 0.6));
        this.drawProgress();
        this.progRaf = requestAnimationFrame(tick);
      };
      this.progRaf = requestAnimationFrame(tick);
    }
  }

  private drawProgress(): void {
    if (!this.prog) return;
    const v = Math.min(1, this.progShown);
    this.prog.fill.style.width = `${(v * 100).toFixed(1)}%`;
    this.prog.pct.textContent = `${Math.floor(v * 100)}%`;
  }

  /** 結束進度：成功顯示 100% 與完成訊息（幾秒後自動關閉），失敗顯示原因並等使用者關閉 */
  progressEnd(text: string, ok: boolean): void {
    if (!this.prog) this.progress('', 0);
    const p = this.prog!;
    cancelAnimationFrame(this.progRaf);
    this.progRaf = 0;
    if (ok) this.progShown = 1;
    this.drawProgress();
    p.label.textContent = text;
    p.back.classList.add(ok ? 'done' : 'fail');
    if (ok) p.pct.textContent = '100% ✔';
    const b = el('button', 'btn', p.foot);
    b.textContent = t('close');
    const close = () => {
      clearTimeout(this.progTimer);
      p.back.remove();
      if (this.prog === p) this.prog = null;
    };
    b.addEventListener('click', close);
    if (ok) this.progTimer = window.setTimeout(close, 4000);
  }

  /** 名字與泡泡跟著悅靈頭頂移動 */
  place(x: number, y: number, visible: boolean): void {
    const tf = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    this.nameTag.style.transform = tf;
    this.bubble.style.transform = `translate(${x.toFixed(1)}px, ${(y - 30).toFixed(1)}px) translate(-50%, -100%)`;
    this.nameTag.style.visibility = visible ? 'visible' : 'hidden';
  }

  setName(name: string): void {
    this.nameTag.textContent = name;
  }

  private modal(title: string): { box: HTMLDivElement; close: () => void } {
    const back = el('div', 'modal-back', this.root);
    const box = el('div', 'modal', back);
    el('h2', '', box).textContent = title;
    // 視窗裡的按鈕都有原版點擊聲（物品欄的格子另有關箱子的聲音）
    box.addEventListener('click', (e) => {
      if (!box.classList.contains('bag') && (e.target as HTMLElement).closest('.btn, .pcard')) this.actions.sfx('click');
    });
    return { box, close: () => back.remove() };
  }

  private personalityPicker(parent: HTMLElement, current: Personality, onPick: (p: Personality) => void): void {
    const grid = el('div', 'pgrid', parent);
    PERSONALITY_IDS.forEach((p) => {
      const b = el('button', 'pcard' + (p === current ? ' on' : ''), grid);
      b.dataset.p = p;
      b.style.setProperty('--pc', PERSONALITY_COLOR[p]);
      const txt = personalityText(p);
      el('b', '', b).textContent = txt.label;
      el('span', '', b).textContent = txt.desc;
      b.addEventListener('click', () => {
        grid.querySelectorAll('.pcard').forEach((x) => x.classList.toggle('on', x === b));
        onPick(p);
      });
    });
  }

  /** 語言選擇（換語言後會重新載入畫面） */
  private langPicker(parent: HTMLElement): void {
    const row = el('div', 'btnrow', parent);
    (Object.keys(LANGS) as Lang[]).forEach((l) => {
      const b = el('button', 'btn' + (l === getLang() ? ' on' : ''), row);
      b.dataset.lang = l;
      b.textContent = LANGS[l];
      b.addEventListener('click', () => l !== getLang() && this.actions.setLang(l));
    });
  }

  /** 設定頁：說話的聲音（裝置內建語音；手機剛開時語音清單可能還沒準備好，準備好再畫一次） */
  private ttsPicker(box: HTMLElement): void {
    el('label', '', box).textContent = t('tts.title', { l: LANGS[getLang()] });
    el('div', 'info', box).textContent = t('tts.help');
    const grid = el('div', 'pgrid voicegrid ttsgrid', box);
    const draw = () => {
      if (!grid.isConnected && grid.childElementCount) {
        window.speechSynthesis?.removeEventListener('voiceschanged', draw);
        return;
      }
      grid.replaceChildren();
      const list = this.actions.ttsVoices();
      if (!list.length) {
        el('div', 'info', grid).textContent = t('tts.none');
        return;
      }
      const cur = this.actions.ttsVoice();
      const opts: [string, string][] = [['', t('tts.auto')], ...list.map((v): [string, string] => [v.voiceURI, voiceLabel(v)])];
      for (const [uri, label] of opts) {
        const b = el('button', 'btn small' + (uri === cur ? ' on' : ''), grid);
        b.textContent = label;
        b.addEventListener('click', () => {
          grid.querySelectorAll('.btn').forEach((x) => x.classList.toggle('on', x === b));
          this.actions.setTtsVoice(uri);
        });
      }
    };
    draw();
    window.speechSynthesis?.addEventListener('voiceschanged', draw);
  }

  /** 設定頁：音樂與音效（像原版的設定畫面：全部靜音 + 各分類的音量滑桿） */
  private volumeEditor(box: HTMLElement): void {
    el('label', '', box).textContent = t('sound');
    const { vol, muted } = this.actions.volumes();
    const mute = el('button', 'btn mute' + (muted ? ' on' : ''), box);
    const help = el('div', 'info', box);
    const sliders: HTMLElement[] = [];
    const showMute = (on: boolean) => {
      mute.textContent = on ? t('muteAllOn') : t('muteAll');
      mute.classList.toggle('on', on);
      help.textContent = on ? t('muteHelpOn') : t('muteHelp');
      sliders.forEach((s) => s.classList.toggle('dim', on));
    };
    mute.addEventListener('click', () => {
      const on = !mute.classList.contains('on');
      this.actions.setMuted(on);
      showMute(on);
    });
    for (const k of VOLUME_KINDS) {
      const row = el('div', 'vol', box);
      const top = el('div', 'vtop', row);
      el('span', '', top).textContent = t(`vol.${k}`);
      const val = el('span', 'vval', top);
      const r = el('input', '', row);
      r.type = 'range';
      r.min = '0';
      r.max = '100';
      r.step = '5';
      r.value = String(Math.round(vol[k] * 100));
      const show = () => (val.textContent = r.value === '0' ? t('off') : `${r.value}%`);
      show();
      r.addEventListener('input', () => {
        show();
        this.actions.setVolume(k, Number(r.value) / 100);
      });
      r.addEventListener('change', () => this.actions.previewVolume(k));
      sliders.push(row);
    }
    showMute(muted);
  }

  /** 設定頁：錄 5 句回應（目前語言）。按「錄音」開始，說完會自動停止 */
  private replyEditor(box: HTMLElement): void {
    el('label', '', box).textContent = t('replies', { l: LANGS[getLang()] });
    el('div', 'info', box).textContent = t('repliesHelp');
    // 變聲：精靈／小孩／少女
    const vrow = el('div', 'pgrid voicegrid', box);
    for (const v of VOICE_STYLES) {
      const b = el('button', 'btn small' + (v === this.actions.voiceStyle() ? ' on' : ''), vrow);
      b.textContent = t(`voice.${v}`);
      b.addEventListener('click', () => {
        vrow.querySelectorAll('.btn').forEach((x) => x.classList.toggle('on', x === b));
        this.actions.setVoiceStyle(v);
        // 換了聲音就播一句有錄的來聽聽看
        const first = this.actions.replies().findIndex((x) => x);
        if (first >= 0) this.actions.playReply(first);
      });
    }
    const has = this.actions.replies();
    for (let i = 0; i < has.length; i++) {
      const row = el('div', 'btnrow reply', box);
      const rec = el('button', 'btn', row);
      const play = el('button', 'btn small', row);
      const del = el('button', 'btn small', row);
      play.textContent = '▶';
      del.textContent = '✕';
      const show = (on: boolean) => {
        rec.textContent = `${i + 1}　${on ? t('replyRerecord') : t('replyRecord')}`;
        play.disabled = del.disabled = !on;
      };
      show(has[i]);
      let stop: (() => void) | null = null;
      rec.addEventListener('click', async () => {
        if (stop) return stop();
        const r = await this.actions.recordReply(i);
        if (!r) return;
        stop = r.stop;
        rec.textContent = `${i + 1}　■ ${t('replyRecording')}`;
        rec.classList.add('on');
        const ok = await r.done;
        stop = null;
        rec.classList.remove('on');
        if (!ok) this.toast(t('micNothing'));
        show(ok || !play.disabled);
      });
      play.addEventListener('click', () => this.actions.playReply(i));
      del.addEventListener('click', () => {
        this.actions.deleteReply(i);
        show(false);
      });
    }
  }

  openOnboarding(): void {
    const { box, close } = this.modal(t('onboardTitle'));
    this.langPicker(box);
    el('p', '', box).textContent = t('onboardText');
    const input = el('input', 'name-input', box);
    input.maxLength = NAME_MAX;
    const defaultName = t('defaultName');
    input.value = defaultName;
    let p: Personality = 'playful';
    this.personalityPicker(box, p, (x) => (p = x));
    const go = el('button', 'btn primary', box);
    go.textContent = t('start');
    go.addEventListener('click', () => {
      this.actions.onboard(input.value.trim() || defaultName, p);
      close();
    });
    if (!this.actions.assetSource()) {
      // 新裝置上先提示匯入原版素材包（網站本身不含原版檔案）
      const hint = el('div', 'info', box);
      hint.textContent = t('packHint');
      const ai = el('button', 'btn', box);
      ai.textContent = t('packImport');
      const afile = el('input', '', box);
      afile.type = 'file';
      afile.accept = PACK_ACCEPT;
      afile.style.display = 'none';
      afile.dataset.kind = 'assets';
      ai.addEventListener('click', () => afile.click());
      afile.addEventListener('change', () => {
        if (!afile.files?.[0]) return;
        this.actions.importAssets(afile.files[0]);
        hint.remove();
        ai.remove();
      });
    }
  }

  private openSettings(): void {
    const s = this.getPet();
    const { box, close } = this.modal(t('settings'));
    el('label', '', box).textContent = t('name');
    const input = el('input', 'name-input', box);
    input.maxLength = NAME_MAX;
    input.value = s.name;
    input.addEventListener('change', () => input.value.trim() && this.actions.rename(input.value.trim()));
    el('label', '', box).textContent = t('personality');
    this.personalityPicker(box, s.personality, (p) => this.actions.setPersonality(p));

    el('label', '', box).textContent = t('language');
    this.langPicker(box);
    this.ttsPicker(box);

    this.volumeEditor(box);

    el('label', '', box).textContent = t('voiceTone');
    const srow = el('div', 'btnrow', box);
    (['bright', 'soft'] as SoundMode[]).forEach((m) => {
      const b = el('button', 'btn' + (m === this.actions.soundMode() ? ' on' : ''), srow);
      b.dataset.sound = m;
      b.textContent = t(`sound.${m}`);
      b.addEventListener('click', () => {
        srow.querySelectorAll('.btn').forEach((x) => x.classList.toggle('on', x === b));
        this.actions.setSoundMode(m);
      });
    });
    if (!this.actions.soundAvailable()) el('div', 'info', box).textContent = t('soundNeed');

    if (!this.actions.musicAvailable()) el('div', 'info', box).textContent = t('bgmNeed');

    el('label', '', box).textContent = t('glow');
    const grow = el('div', 'btnrow', box);
    for (const on of [true, false]) {
      const b = el('button', 'btn' + (on === this.actions.glow() ? ' on' : ''), grow);
      b.dataset.glow = on ? 'on' : 'off';
      b.textContent = t(on ? 'on' : 'off');
      b.addEventListener('click', () => {
        grow.querySelectorAll('.btn').forEach((x) => x.classList.toggle('on', x === b));
        this.actions.setGlow(on);
      });
    }

    el('label', '', box).textContent = t('biome');
    const bgrid = el('div', 'pgrid', box);
    for (const b of BIOMES) {
      const btn = el('button', 'btn' + (b === this.actions.biome() ? ' on' : ''), bgrid);
      btn.dataset.biome = b;
      btn.textContent = t(`biome.${b}`);
      btn.addEventListener('click', () => {
        bgrid.querySelectorAll('.btn').forEach((x) => x.classList.toggle('on', x === btn));
        this.actions.setBiome(b);
      });
    }

    this.replyEditor(box);

    // 開發選項：測試用的設定集中在這裡
    el('label', '', box).textContent = t('dev.title');
    const dev = el('button', 'btn' + (loadDevTap(localStorage) ? ' on' : ''), box);
    const devHelp = el('div', 'info', box);
    const showDev = () => {
      const on = loadDevTap(localStorage);
      dev.textContent = `${t('dev.tap')}：${t(on ? 'on' : 'off')}`;
      dev.classList.toggle('on', on);
      devHelp.textContent = t('dev.tapHelp');
    };
    showDev();
    dev.addEventListener('click', () => {
      saveDevTap(localStorage, !loadDevTap(localStorage));
      showDev();
    });

    el('label', '', box).textContent = t('bedtime');
    const brow = el('div', 'btnrow', box);
    const bhelp = el('div', 'info', box);
    const showBed = (b: Bedtime) => (bhelp.textContent = t('bedtimeHelp', { b, w: wakeHour(b) }));
    for (const b of BEDTIMES) {
      const btn = el('button', 'btn' + (b === this.actions.bedtime() ? ' on' : ''), brow);
      btn.dataset.bed = String(b);
      btn.textContent = `${b}:00`;
      btn.addEventListener('click', () => {
        brow.querySelectorAll('.btn').forEach((x) => x.classList.toggle('on', x === btn));
        this.actions.setBedtime(b);
        showBed(b);
      });
    }
    showBed(this.actions.bedtime());

    const info = el('div', 'info', box);
    const days = Math.max(1, Math.ceil((Date.now() - s.createdAt) / 86400000));
    for (const line of [
      t('mood', { m: t(`mood.${moodLevel(s.mood)}`) }),
      t('days', { d: days, lv: t(`aff.${affectionLevel(s.affection)}`) }),
      t('counts', { f: s.stats.fed, p: s.stats.petted, g: s.stats.played }),
    ]) el('div', '', info).textContent = line;

    el('label', '', box).textContent = t('link');
    const linfo = el('div', 'info', box);
    el('div', '', linfo).textContent = t('linkInfo', { id: s.id });
    el('div', '', linfo).textContent = t('linkHelp');
    const lrow = el('div', 'btnrow', box);
    const ls = el('button', 'btn', lrow);
    ls.textContent = t('linkSend');
    ls.addEventListener('click', () => this.actions.shareLink());
    const lp = el('button', 'btn', lrow);
    lp.textContent = t('linkPaste');
    lp.addEventListener('click', () => {
      close();
      this.actions.pasteLink();
    });

    el('label', '', box).textContent = t('saveLabel');
    const row = el('div', 'btnrow', box);
    const ex = el('button', 'btn', row);
    ex.textContent = t('saveExport');
    ex.addEventListener('click', () => this.actions.exportSave());
    const im = el('button', 'btn', row);
    im.textContent = t('saveImport');
    const file = el('input', '', box);
    file.type = 'file';
    file.accept = 'application/json,.json';
    file.style.display = 'none';
    file.dataset.kind = 'save';
    im.addEventListener('click', () => file.click());
    file.addEventListener('change', () => {
      if (file.files?.[0]) {
        this.actions.importSave(file.files[0]);
        close();
      }
    });
    const src = this.actions.assetSource();
    el('label', '', box).textContent = t('packLabel');
    el('div', 'info', box).textContent = src ? t('packApplied', { v: src }) : t('packNone');
    const arow = el('div', 'btnrow', box);
    const ai = el('button', 'btn', arow);
    ai.textContent = src ? t('packReimport') : t('packImport');
    const afile = el('input', '', box);
    afile.type = 'file';
    afile.accept = PACK_ACCEPT;
    afile.style.display = 'none';
    afile.dataset.kind = 'assets';
    ai.addEventListener('click', () => afile.click());
    afile.addEventListener('change', () => {
      if (afile.files?.[0]) {
        this.actions.importAssets(afile.files[0]);
        close();
      }
    });
    if (src) {
      const ac = el('button', 'btn', arow);
      ac.textContent = t('packRemove');
      ac.addEventListener('click', () => {
        close();
        this.actions.clearAssets();
      });
    }

    const reset = el('button', 'btn danger', box);
    reset.textContent = t('reset');
    reset.addEventListener('click', () => {
      if (confirm(t('resetConfirm'))) {
        close();
        this.actions.reset();
      }
    });
    // 設定很長：依項目分組，點標題開合（一次開一個）
    this.foldSections(box, [
      [t('name'), t('sec.pet')],
      [t('language'), t('sec.sound')],
      [t('glow'), t('sec.look')],
      [t('replies', { l: LANGS[getLang()] }), t('sec.replies')],
      [t('dev.title'), t('sec.dev')],
      [t('bedtime'), t('sec.time')],
      [t('link'), t('sec.save')],
      [t('packLabel'), t('sec.pack')],
    ]);
    el('div', 'ver', box).textContent = `FairyPocket v${__APP_VERSION__}`;
    const done = el('button', 'btn primary', box);
    done.textContent = t('done');
    done.addEventListener('click', () => {
      if (input.value.trim()) this.actions.rename(input.value.trim());
      close();
    });
  }

  /** 上次打開的設定分組（這次開啟 App 期間記住） */
  private openSection = '';

  /**
   * 把設定頁的內容依標題分組：遇到 starts 裡的標題就開始新的一組，到「重設」按鈕為止。
   * 每組變成一個可以開合的區塊，一次只開一個。
   */
  private foldSections(box: HTMLElement, starts: [string, string][]): void {
    const titles = new Map(starts);
    const kids = Array.from(box.children) as HTMLElement[];
    let body: HTMLElement | null = null;
    const heads: { head: HTMLElement; body: HTMLElement; title: string }[] = [];
    for (const k of kids) {
      if (k.classList.contains('danger')) break;
      const title = k.tagName === 'LABEL' ? titles.get(k.textContent ?? '') : undefined;
      if (title) {
        const sect = el('div', 'sect');
        box.insertBefore(sect, k);
        const head = el('button', 'btn sect-head', sect);
        head.textContent = title;
        body = el('div', 'sect-body', sect);
        heads.push({ head, body, title });
      }
      if (body) body.appendChild(k);
    }
    // 開發選項放在最後
    const dev = heads.find((h) => h.title === t('sec.dev'));
    const last = heads[heads.length - 1];
    if (dev && last && dev !== last) last.head.parentElement!.after(dev.head.parentElement!);
    const show = (title: string) => {
      this.openSection = title;
      for (const h of heads) {
        const on = h.title === title;
        h.head.classList.toggle('on', on);
        h.body.style.display = on ? '' : 'none';
      }
    };
    for (const h of heads) {
      h.head.addEventListener('click', () => {
        this.actions.sfx('click');
        show(this.openSection === h.title ? '' : h.title);
      });
    }
    show(this.openSection);
  }

  /** 由 main 設定，讓設定頁讀到最新狀態 */
  getPet: () => PetState = () => {
    throw new Error('getPet not set');
  };
}
