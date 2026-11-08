// 生命模式的內在需求（不是隨機事件，全部來自真的發生的事）：
// - 無聊：一直做差不多的事會慢慢無聊，換一件事或發生有趣的事就好了 → 想做點不一樣的
// - 想家人：很久沒人跟她互動會慢慢想念，有人跟她說話、摸她、餵她就滿足了 → 偶爾去看看家人（不黏人）
// - 重複的刺激會習慣：幾分鐘內被摸好幾次，反應會變淡（或有點煩），交給 AI 決定
// 數值只在手機裡、只影響生命模式，不改寵物的數值（不影響 MC／FP 整合）。
import type { Lang } from '../i18n';
import type { Intent } from './life';

export interface Drives {
  /** 0–1：越高越想做點不一樣的 */
  boredom: number;
  /** 0–1：越高越想念家人 */
  lonely: number;
}

export function newDrives(): Drives {
  return { boredom: 0.2, lonely: 0.2 };
}

/** 無聊幾分鐘會到滿、想家人幾分鐘會到滿 */
const BORED_MIN = 6;
const LONELY_MIN = 15;

/** 每秒更新：做同一類的事會無聊；沒人互動會想念（睡覺時不變） */
export function tickDrives(d: Drives, sec: number, asleep: boolean): void {
  if (asleep) return;
  d.boredom = Math.min(1, d.boredom + sec / (BORED_MIN * 60));
  d.lonely = Math.min(1, d.lonely + sec / (LONELY_MIN * 60));
}

/**
 * 換了一件真的不一樣的事：無聊減少。最近幾件裡做過的（例如兩件事輪流做）幾乎不會變好
 * （實驗：只看上一件時，她會在「整理翅膀」和「巡邏」之間一直輪流）
 */
export function newActivity(d: Drives, i: Intent, recent: readonly Intent[]): void {
  d.boredom = Math.max(0, d.boredom - (recent.slice(-3).includes(i) ? 0.05 : 0.6));
  if (i === 'approach' || i === 'peek') d.lonely = Math.max(0, d.lonely - 0.25);
}

/** 家人跟她互動（說話、摸、餵、玩）：不想念了，也不無聊了 */
export function interacted(d: Drives): void {
  d.lonely = Math.max(0, d.lonely - 0.6);
  d.boredom = Math.max(0, d.boredom - 0.3);
}

/** 給 AI 看的感覺（只有明顯的才說） */
/** fresh：最近沒做過的活動名稱（無聊時建議的） */
export function drivesText(d: Drives, lang: Lang, fresh: string[] = []): string {
  const out: string[] = [];
  const W = {
    zh_tw: { try: (f: string[]) => `（這次選一件最近沒做過的，例如「${f.slice(0, 3).join('」「')}」）`, go: '（這次可以選「靠近家人」或「躲起來偷看」）', bored: '一直做差不多的事，有點無聊了，想做點不一樣的', lonely: '好一陣子沒跟家人互動了，有點想念他們（可以去看看他們在做什麼，但不用黏著）', full: '剛跟家人互動過，心滿意足，可以安心做自己的事' },
    ja_jp: { try: (f: string[]) => `（こんどはさいきんしていないことを。たとえば「${f.slice(0, 3).join('」「')}」）`, go: '（こんどは「ちかづく」や「かくれてのぞく」をえらんでもいい）', bored: 'にたようなことばかりで、ちょっとたいくつ。ちがうことがしたい', lonely: 'しばらくかぞくとかかわっていなくて、ちょっとさみしい（なにをしているか見にいってもいいけど、べったりはしない）', full: 'かぞくとかかわったばかりで満足。安心して自分のことができる' },
    en_us: { try: (f: string[]) => ` (this time pick something you haven't done lately, like "${f.slice(0, 3).join('", "')}")`, go: ' (this time you could pick "come closer" or "hide and peek")', bored: "You've been doing similar things for a while and feel a bit bored; you want something different", lonely: "It's been a while since the family interacted with you; you miss them a little (you could check what they're doing, without clinging)", full: 'You just spent time with the family and feel content; you can happily do your own thing' },
  }[lang];
  if (d.boredom > 0.65) out.push(W.bored + (fresh.length ? W.try(fresh) : ''));
  if (d.lonely > 0.7) out.push(W.lonely + W.go);
  else if (d.lonely < 0.1) out.push(W.full);
  return out.join(lang === 'en_us' ? '. ' : '；');
}

/** 需求影響清單順序：無聊時沒做過的活動排前面；想家人時「去看看家人」「偷看」排前面 */
export function drivesPrefer(d: Drives, recent: Intent[]): Intent[] {
  const out: Intent[] = [];
  if (d.lonely > 0.7) out.push('approach', 'peek');
  if (d.boredom > 0.65) for (const i of ['explore', 'search', 'patrol', 'dance', 'sing', 'inspect'] as Intent[]) if (!recent.includes(i)) out.push(i);
  return out;
}

// ---------- 重複的刺激會習慣 ----------
const WINDOW = 3 * 60_000;
export class Habituation {
  private seen = new Map<string, number[]>();
  /** 記一次，回傳這幾分鐘內是第幾次 */
  count(kind: string, now = Date.now()): number {
    const list = (this.seen.get(kind) ?? []).filter((t) => now - t < WINDOW);
    list.push(now);
    this.seen.set(kind, list);
    return list.length;
  }
}
/** 第 3 次以上才加說明 */
export function repeatText(n: number, lang: Lang): string {
  if (n < 3) return '';
  if (lang === 'ja_jp') return `（この数分で${n}回目）`;
  if (lang === 'en_us') return ` (that's the ${n}th time in a few minutes)`;
  return `（這幾分鐘內第 ${n} 次了）`;
}

/** 今天的事用「多久以前」表示（小模型看不懂幾點幾分是多久以前） */
export function ago(ms: number, lang: Lang): string {
  const m = Math.round(ms / 60_000);
  if (lang === 'ja_jp') return m < 2 ? 'さっき' : m < 60 ? `${m}分前` : `${Math.round(m / 60)}時間前`;
  if (lang === 'en_us') return m < 2 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
  return m < 2 ? '剛剛' : m < 60 ? `${m} 分鐘前` : `${Math.round(m / 60)} 小時前`;
}
