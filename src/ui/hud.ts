// 畫面上的 HTML 介面：名字、對話泡泡、愛心 / 飽食度、快捷欄、設定與開場。

import { gridURL, HEART, HEART_PAL, ITEM_ICONS, SHANK, SHANK_PAL, statGrid } from '../pixel';
import { affectionLevel, NAME_MAX, PERSONALITIES, toIcons, type Personality, type PetState } from '../game/state';
import type { AssetImages } from '../game/assets';

export type Slot = 'apple' | 'bread' | 'feather' | 'slime' | 'call';
export const SLOTS: { id: Slot; label: string; hint: string }[] = [
  { id: 'apple', label: '蘋果', hint: '點悅靈餵食' },
  { id: 'bread', label: '麵包', hint: '點悅靈餵食' },
  { id: 'feather', label: '羽毛', hint: '點悅靈搔癢' },
  { id: 'slime', label: '史萊姆球', hint: '點畫面丟球' },
  { id: 'call', label: '呼喚', hint: '' },
];

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
  exportSave(): void;
  importSave(file: File): void;
  reset(): void;
  onboard(name: string, p: Personality): void;
  importAssets(file: File): void;
  clearAssets(): void;
  /** 已套用的原版素材版本，未套用時為 null */
  assetSource(): string | null;
}

export class Hud {
  readonly nameTag: HTMLDivElement;
  readonly bubble: HTMLDivElement;
  private hearts: HTMLImageElement[] = [];
  private shanks: HTMLImageElement[] = [];
  private slots: HTMLButtonElement[] = [];
  private itemName: HTMLDivElement;
  private toastEl: HTMLDivElement;
  private bubbleTimer = 0;
  private itemTimer = 0;
  private heartURL: string[];
  private shankURL: string[];
  selected: Slot | null = null;
  private lastStat = '';
  private bar!: HTMLDivElement;
  private selFrame!: HTMLDivElement;
  private mc: { hotbarW: number; selW: number; selH: number } | null = null;

  constructor(private root: HTMLElement, private actions: HudActions) {
    this.nameTag = el('div', 'nametag', root);
    this.bubble = el('div', 'bubble', root);

    // 0=空 1=半 2=滿
    this.heartURL = [0, 1, 2].map((l) => gridURL(statGrid(HEART, l, 4, false), HEART_PAL));
    this.shankURL = [0, 1, 2].map((l) => gridURL(statGrid(SHANK, l, 4, true), SHANK_PAL));

    const gear = el('button', 'gear', root);
    gear.setAttribute('aria-label', '設定');
    gear.textContent = '⚙';
    gear.addEventListener('click', () => this.openSettings());

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
    SLOTS.forEach((s) => {
      const b = el('button', 'slot', bar);
      b.setAttribute('aria-label', s.label);
      b.dataset.slot = s.id;
      const img = el('img', '', b);
      img.src = gridURL(ITEM_ICONS[s.id].grid, ITEM_ICONS[s.id].pal, 4);
      img.alt = s.label;
      b.addEventListener('click', () => {
        if (s.id === 'call') {
          this.showItem('呼喚');
          this.actions.call();
          return;
        }
        this.setSelected(this.selected === s.id ? null : s.id);
      });
      this.slots.push(b);
    });
    this.toastEl = el('div', 'toast', root);
  }

  setSelected(slot: Slot | null): void {
    this.selected = slot;
    this.slots.forEach((b) => b.classList.toggle('selected', b.dataset.slot === slot));
    this.layout();
    const s = SLOTS.find((x) => x.id === slot);
    if (s) this.showItem(`${s.label}　${s.hint}`);
    this.actions.select(slot);
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

    const items: Record<Slot, HTMLImageElement | undefined> = {
      apple: img.apple, bread: img.bread, feather: img.feather, slime: img.slime_ball, call: img.note_block,
    };
    this.slots.forEach((b) => {
      const src = items[b.dataset.slot as Slot];
      if (src) b.querySelector('img')!.src = src.src;
    });

    if (img.hotbar && img.hotbar_selection) {
      // 原版快捷欄有 9 格，這裡裁成 5 格（左邊 5 格 + 最右側邊框）
      const w = 1 + SLOTS.length * 20 + 1;
      const { c, ctx } = canvas(w, img.hotbar.height);
      ctx.drawImage(img.hotbar, 0, 0, w - 1, img.hotbar.height, 0, 0, w - 1, img.hotbar.height);
      ctx.drawImage(img.hotbar, img.hotbar.width - 1, 0, 1, img.hotbar.height, w - 1, 0, 1, img.hotbar.height);
      this.bar.style.backgroundImage = `url(${c.toDataURL()})`;
      this.selFrame.style.backgroundImage = `url(${img.hotbar_selection.src})`;
      this.mc = { hotbarW: w, selW: img.hotbar_selection.width, selH: img.hotbar_selection.height };
      this.root.classList.add('mc');
      window.addEventListener('resize', () => this.layout());
      this.layout();
    }
  }

  /** 原版模式下依螢幕寬度以整數倍放大像素介面 */
  private layout(): void {
    if (!this.mc) return;
    const s = Math.max(2, Math.floor(Math.min(window.innerWidth - 24, 420) / this.mc.hotbarW));
    const r = this.root.style;
    r.setProperty('--s', `${s}px`);
    r.setProperty('--u', `${(this.mc.hotbarW * s - 8) / 162}px`);
    const i = SLOTS.findIndex((x) => x.id === this.selected);
    this.selFrame.style.display = i < 0 ? 'none' : 'block';
    this.selFrame.style.left = `${(i * 20 - 1) * s}px`;
    this.selFrame.style.width = `${this.mc.selW * s}px`;
    this.selFrame.style.height = `${this.mc.selH * s}px`;
    this.bar.style.width = `${this.mc.hotbarW * s}px`;
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
    window.setTimeout(() => this.toastEl.classList.remove('show'), 2400);
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
    return { box, close: () => back.remove() };
  }

  private personalityPicker(parent: HTMLElement, current: Personality, onPick: (p: Personality) => void): void {
    const grid = el('div', 'pgrid', parent);
    (Object.keys(PERSONALITIES) as Personality[]).forEach((p) => {
      const b = el('button', 'pcard' + (p === current ? ' on' : ''), grid);
      b.dataset.p = p;
      el('b', '', b).textContent = PERSONALITIES[p].label;
      el('span', '', b).textContent = PERSONALITIES[p].desc;
      b.addEventListener('click', () => {
        grid.querySelectorAll('.pcard').forEach((x) => x.classList.toggle('on', x === b));
        onPick(p);
      });
    });
  }

  openOnboarding(defaultName: string): void {
    const { box, close } = this.modal('認識你的悅靈');
    el('p', '', box).textContent = '幫牠取個名字，並選擇牠的個性吧！';
    const input = el('input', 'name-input', box);
    input.maxLength = NAME_MAX;
    input.value = defaultName;
    let p: Personality = 'playful';
    this.personalityPicker(box, p, (x) => (p = x));
    const go = el('button', 'btn primary', box);
    go.textContent = '開始！';
    go.addEventListener('click', () => {
      this.actions.onboard(input.value.trim() || defaultName, p);
      close();
    });
  }

  private openSettings(): void {
    const s = this.getPet();
    const { box, close } = this.modal('設定');
    el('label', '', box).textContent = '名字';
    const input = el('input', 'name-input', box);
    input.maxLength = NAME_MAX;
    input.value = s.name;
    input.addEventListener('change', () => input.value.trim() && this.actions.rename(input.value.trim()));
    el('label', '', box).textContent = '個性';
    this.personalityPicker(box, s.personality, (p) => this.actions.setPersonality(p));

    const info = el('div', 'info', box);
    const days = Math.max(1, Math.ceil((Date.now() - s.createdAt) / 86400000));
    for (const line of [
      `相處第 ${days} 天　關係：${affectionLevel(s.affection)}`,
      `餵食 ${s.stats.fed} 次　摸摸 ${s.stats.petted} 次　玩耍 ${s.stats.played} 次`,
    ]) el('div', '', info).textContent = line;

    el('label', '', box).textContent = '存檔（自動儲存在本機）';
    const row = el('div', 'btnrow', box);
    const ex = el('button', 'btn', row);
    ex.textContent = '匯出存檔';
    ex.addEventListener('click', () => this.actions.exportSave());
    const im = el('button', 'btn', row);
    im.textContent = '還原存檔';
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
    el('label', '', box).textContent = '原版素材';
    el('div', 'info', box).textContent = src ? `已套用 Minecraft ${src} 原版素材（只存在這台裝置）` : '目前使用暫用素材。匯入「原版素材包」即可換成 Minecraft 原版外觀。';
    const arow = el('div', 'btnrow', box);
    const ai = el('button', 'btn', arow);
    ai.textContent = src ? '重新匯入' : '匯入原版素材';
    const afile = el('input', '', box);
    afile.type = 'file';
    afile.accept = 'application/json,.json';
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
      ac.textContent = '移除原版素材';
      ac.addEventListener('click', () => {
        close();
        this.actions.clearAssets();
      });
    }

    const reset = el('button', 'btn danger', box);
    reset.textContent = '重新開始（清除存檔）';
    reset.addEventListener('click', () => {
      if (confirm('確定要清除存檔並重新開始嗎？建議先匯出存檔。')) {
        close();
        this.actions.reset();
      }
    });
    el('div', 'ver', box).textContent = `FairyPocket v${__APP_VERSION__}`;
    const done = el('button', 'btn primary', box);
    done.textContent = '完成';
    done.addEventListener('click', () => {
      if (input.value.trim()) this.actions.rename(input.value.trim());
      close();
    });
  }

  /** 由 main 設定，讓設定頁讀到最新狀態 */
  getPet: () => PetState = () => {
    throw new Error('getPet not set');
  };
}
