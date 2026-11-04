// 情境音效（Fairy Pocket 音效標準 E）：每個情境對應一個原版音效、音量與音高範圍。
// 音檔來自玩家自己的原版素材包；有多個版本（例如 eat1～3）時會隨機挑一個。
// 悅靈發言的叫聲＋紫水晶鈴聲另見 audio.ts 的 speak()，維持原本的規格。

export type Sfx =
  | 'flap' | 'dash' | 'snore' | 'bite' | 'burp' | 'wake' | 'startle'
  | 'pickup' | 'slime' | 'throw' | 'tickle' | 'click' | 'open' | 'close' | 'bell' | 'levelup';

export const SFX: Record<Sfx, { path: string; vol: number; pitch: [number, number] }> = {
  flap: { path: 'sounds/mob/parrot/fly', vol: 0.3, pitch: [1.3, 1.6] }, // 起飛、遊蕩時拍翅膀
  dash: { path: 'sounds/mob/bat/takeoff', vol: 0.25, pitch: [1.4, 1.7] }, // 被呼喚、追球時衝刺
  snore: { path: 'sounds/mob/fox/sleep', vol: 0.35, pitch: [1.2, 1.4] }, // 睡覺時輕輕打呼
  bite: { path: 'sounds/random/eat', vol: 0.45, pitch: [1.0, 1.4] }, // 吃東西每一口
  burp: { path: 'sounds/random/burp', vol: 0.35, pitch: [1.2, 1.4] }, // 吃完
  wake: { path: 'sounds/mob/allay/item_taken', vol: 0.5, pitch: [1.1, 1.3] }, // 醒來
  startle: { path: 'sounds/mob/allay/hurt', vol: 0.45, pitch: [1.2, 1.4] }, // 被嚇醒
  pickup: { path: 'sounds/random/pop', vol: 0.4, pitch: [1.2, 2.0] }, // 接住東西（原版撿東西的聲音）
  slime: { path: 'sounds/mob/slime/small', vol: 0.45, pitch: [1.0, 1.3] }, // 接住史萊姆球
  throw: { path: 'sounds/random/bow', vol: 0.35, pitch: [0.45, 0.6] }, // 丟出去（原版丟雪球的聲音）
  tickle: { path: 'sounds/mob/allay/item_given', vol: 0.55, pitch: [1.1, 1.3] }, // 用羽毛搔癢
  click: { path: 'sounds/random/click', vol: 0.3, pitch: [1, 1] }, // 快捷欄、按鈕
  open: { path: 'sounds/block/chest/open', vol: 0.35, pitch: [1, 1.1] }, // 打開物品欄
  close: { path: 'sounds/block/chest/close', vol: 0.35, pitch: [1, 1.1] }, // 關上物品欄
  bell: { path: 'sounds/block/bell/bell_use0', vol: 0.5, pitch: [1, 1] }, // 呼喚（敲鐘）；原版檔名是 bell_use01、bell_use02
  levelup: { path: 'sounds/random/levelup', vol: 0.35, pitch: [1, 1] }, // 很久不見的重逢
};

export function sfxPitch(s: Sfx, rnd = Math.random): number {
  const [a, b] = SFX[s].pitch;
  return a + (b - a) * rnd();
}
