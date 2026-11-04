// 介面語言：繁體中文、日文、英文。物品與生物名稱以 Java 版的官方譯名為準。

import type { Food, Personality } from './game/state';

export type Lang = 'zh_tw' | 'ja_jp' | 'en_us';
export const LANGS: Record<Lang, string> = { zh_tw: '繁體中文', ja_jp: '日本語', en_us: 'English' };

const LANG_KEY = 'fairypocket.lang.v1';

/** 已存的語言；沒選過時，舊玩家維持繁中，新玩家依裝置語言 */
export function loadLang(storage: Pick<Storage, 'getItem'>, deviceLang = '', hasSave = false): Lang {
  const v = storage.getItem(LANG_KEY);
  if (v === 'zh_tw' || v === 'ja_jp' || v === 'en_us') return v;
  if (hasSave) return 'zh_tw';
  const d = deviceLang.toLowerCase();
  return d.startsWith('ja') ? 'ja_jp' : d.startsWith('en') ? 'en_us' : 'zh_tw';
}

export function saveLang(storage: Pick<Storage, 'setItem'>, l: Lang): void {
  storage.setItem(LANG_KEY, l);
}

let lang: Lang = 'zh_tw';
export function setLang(l: Lang): void {
  lang = l;
  document.documentElement.lang = { zh_tw: 'zh-Hant-TW', ja_jp: 'ja', en_us: 'en' }[l];
}
export function getLang(): Lang {
  return lang;
}

type Item = Food | 'feather' | 'slime_ball' | 'note_block' | 'bell' | 'amethyst_shard' | 'allay' | 'inventory';

/** Java 版語言檔中的名稱（item.minecraft.* / block.minecraft.* / entity.minecraft.allay / container.inventory） */
const ITEMS: Record<Lang, Record<Item, string>> = {
  zh_tw: {
    apple: '蘋果', bread: '麵包', cookie: '餅乾', carrot: '胡蘿蔔', baked_potato: '烤馬鈴薯', sweet_berries: '甜莓',
    glow_berries: '螢光莓', melon_slice: '西瓜片', cooked_chicken: '烤雞', pumpkin_pie: '南瓜派', honey_bottle: '蜂蜜瓶',
    golden_carrot: '金胡蘿蔔', golden_apple: '金蘋果', feather: '羽毛', slime_ball: '史萊姆球', note_block: '音階盒',
    bell: '鐘', amethyst_shard: '紫水晶碎片', allay: '悅靈', inventory: '物品欄',
  },
  ja_jp: {
    apple: 'リンゴ', bread: 'パン', cookie: 'クッキー', carrot: 'ニンジン', baked_potato: 'ベイクドポテト', sweet_berries: 'スイートベリー',
    glow_berries: 'グロウベリー', melon_slice: 'スイカの薄切り', cooked_chicken: '焼き鳥', pumpkin_pie: 'パンプキンパイ',
    honey_bottle: 'ハチミツ入りの瓶', golden_carrot: '金のニンジン', golden_apple: '金のリンゴ', feather: '羽根',
    slime_ball: 'スライムボール', note_block: '音符ブロック', bell: '鐘', amethyst_shard: 'アメジストの欠片', allay: 'アレイ',
    inventory: 'インベントリ',
  },
  en_us: {
    apple: 'Apple', bread: 'Bread', cookie: 'Cookie', carrot: 'Carrot', baked_potato: 'Baked Potato', sweet_berries: 'Sweet Berries',
    glow_berries: 'Glow Berries', melon_slice: 'Melon Slice', cooked_chicken: 'Cooked Chicken', pumpkin_pie: 'Pumpkin Pie',
    honey_bottle: 'Honey Bottle', golden_carrot: 'Golden Carrot', golden_apple: 'Golden Apple', feather: 'Feather',
    slime_ball: 'Slimeball', note_block: 'Note Block', bell: 'Bell', amethyst_shard: 'Amethyst Shard', allay: 'Allay',
    inventory: 'Inventory',
  },
};

export function itemName(i: Item): string {
  return ITEMS[lang][i];
}

const PERSONALITY_TEXT: Record<Lang, Record<Personality, { label: string; desc: string }>> = {
  zh_tw: {
    guardian: { label: '守護', desc: '溫柔沉穩，總是守在你身邊照顧你' },
    brave: { label: '勇敢', desc: '積極探索，飛得又快又遠，動作很有精神' },
    cautious: { label: '謹慎', desc: '喜歡靠在你身邊，慢慢飛、細心觀察' },
    playful: { label: '愛玩', desc: '活潑調皮又好奇，東張西望，還會即興飛舞' },
  },
  ja_jp: {
    guardian: { label: 'まもり', desc: 'やさしく落ち着いていて、いつもそばで見守ってくれる' },
    brave: { label: 'ゆうかん', desc: '探検が大好き。速く遠くまで元気に飛び回る' },
    cautious: { label: 'しんちょう', desc: 'あなたのそばが好き。ゆっくり飛んで、じっくり観察する' },
    playful: { label: 'あそびずき', desc: '元気でいたずら好き。きょろきょろして、ときどき舞い踊る' },
  },
  en_us: {
    guardian: { label: 'Guardian', desc: 'Calm and gentle, always watching over you' },
    brave: { label: 'Brave', desc: 'Loves exploring and flies fast and far, full of energy' },
    cautious: { label: 'Cautious', desc: 'Stays close to you, flies slowly and watches carefully' },
    playful: { label: 'Playful', desc: 'Lively and curious, looks around a lot and does little flying dances' },
  },
};

export function personalityText(p: Personality): { label: string; desc: string } {
  return PERSONALITY_TEXT[lang][p];
}

const UI = {
  zh_tw: {
    'hint.food': '點畫面丟給{a}',
    'hint.feather': '點{a}搔癢',
    'hint.slime': '按住蓄力，放開丟球',
    'hint.note': '點地面放下，點它彈奏',
    call: '呼喚',
    shardReady: '點跳舞中的{a}送給牠',
    bagEmpty: '選一樣食物丟給{a}吧',
    close: '關閉',
    settings: '設定',
    onboardTitle: '認識你的{a}',
    onboardText: '幫牠取個名字，並選擇牠的個性吧！',
    start: '開始！',
    packHint: '有「原版素材包」嗎？匯入後就是 Minecraft 原版外觀。',
    packImport: '匯入原版素材',
    name: '名字',
    personality: '個性',
    language: '語言',
    sound: '聲音',
    'sound.bright': '明亮',
    'sound.soft': '柔和',
    'sound.off': '關閉',
    soundNeed: '匯入含音效的原版素材包後才會有{a}的聲音。',
    glow: '發光輪廓',
    on: '開啟',
    off: '關閉',
    days: '相處第 {d} 天　關係：{lv}',
    counts: '餵食 {f} 次　摸摸 {p} 次　玩耍 {g} 次',
    'aff.0': '初識',
    'aff.1': '熟悉',
    'aff.2': '好朋友',
    'aff.3': '形影不離',
    saveLabel: '存檔（自動儲存在本機）',
    saveExport: '匯出存檔',
    saveImport: '還原存檔',
    packLabel: '原版素材',
    packApplied: '已套用 Minecraft {v} 原版素材（只存在這台裝置）',
    packNone: '目前使用暫用素材。匯入「原版素材包」即可換成 Minecraft 原版外觀。',
    packReimport: '重新匯入',
    packRemove: '移除原版素材',
    reset: '重新開始（清除存檔）',
    resetConfirm: '確定要清除存檔並重新開始嗎？建議先匯出存檔。',
    done: '完成',
    friendsMax: '最多只能有 {n} 隻夥伴喔',
    friendsWait: '紫水晶的力量還在恢復，再等 {n} 分鐘',
    packImporting: '正在匯入素材包…',
    packDone: '已套用 Minecraft {v} 原版素材',
    saveTitle: 'FairyPocket 存檔',
    saveExported: '已匯出存檔',
    saveDownloaded: '已下載存檔',
    saveConfirm: '要用「{n}」的存檔覆蓋目前進度嗎？',
    saveRestored: '存檔已還原',
    offline: '已可離線遊玩',
    featherMiss: '點一下{a}來搔癢',
    defaultName: '小悅',
  },
  ja_jp: {
    'hint.food': '画面をタップして{a}に投げる',
    'hint.feather': '{a}をタップしてくすぐる',
    'hint.slime': '長押しでためて、離して投げる',
    'hint.note': '地面をタップで置く、タップで鳴らす',
    call: '呼ぶ',
    shardReady: '踊っている{a}をタップして渡す',
    bagEmpty: '{a}に投げる食べ物を選んでね',
    close: '閉じる',
    settings: '設定',
    onboardTitle: '{a}とはじめまして',
    onboardText: '名前をつけて、性格を選んであげよう！',
    start: 'はじめる！',
    packHint: '「バニラ素材パック」はありますか？読み込むと Minecraft の見た目になります。',
    packImport: '素材パックを読み込む',
    name: '名前',
    personality: '性格',
    language: '言語',
    sound: 'サウンド',
    'sound.bright': '明るい',
    'sound.soft': 'やわらか',
    'sound.off': 'オフ',
    soundNeed: 'サウンド入りの素材パックを読み込むと{a}の声が聞こえます。',
    glow: '発光の輪郭',
    on: 'オン',
    off: 'オフ',
    days: 'いっしょに {d} 日目　なかよし度：{lv}',
    counts: 'ごはん {f} 回　なでなで {p} 回　あそび {g} 回',
    'aff.0': 'はじめまして',
    'aff.1': 'なじみ',
    'aff.2': 'なかよし',
    'aff.3': 'いつもいっしょ',
    saveLabel: 'セーブ（この端末に自動保存）',
    saveExport: 'セーブを書き出す',
    saveImport: 'セーブを復元',
    packLabel: 'バニラ素材',
    packApplied: 'Minecraft {v} の素材を使用中（この端末にだけ保存）',
    packNone: '仮の素材を使用中です。「バニラ素材パック」を読み込むと Minecraft の見た目になります。',
    packReimport: '読み込み直す',
    packRemove: '素材を削除',
    reset: '最初からやり直す（セーブを消去）',
    resetConfirm: 'セーブを消して最初からやり直しますか？先に書き出しておくのがおすすめです。',
    done: '完了',
    friendsMax: '仲間は {n} 匹までだよ',
    friendsWait: 'アメジストの力が回復中。あと {n} 分待ってね',
    packImporting: '素材パックを読み込み中…',
    packDone: 'Minecraft {v} の素材を適用しました',
    saveTitle: 'FairyPocket セーブ',
    saveExported: 'セーブを書き出しました',
    saveDownloaded: 'セーブをダウンロードしました',
    saveConfirm: '「{n}」のセーブで今の進行を上書きしますか？',
    saveRestored: 'セーブを復元しました',
    offline: 'オフラインでも遊べます',
    featherMiss: '{a}をタップしてくすぐってね',
    defaultName: 'アレちゃん',
  },
  en_us: {
    'hint.food': 'Tap to toss it to the {a}',
    'hint.feather': 'Tap the {a} to tickle',
    'hint.slime': 'Hold to charge, release to throw',
    'hint.note': 'Tap the ground to place, tap it to play',
    call: 'Call',
    shardReady: 'Tap the dancing {a} to give it',
    bagEmpty: 'Pick a food to toss to the {a}',
    close: 'Close',
    settings: 'Settings',
    onboardTitle: 'Meet your {a}',
    onboardText: 'Give it a name and choose its personality!',
    start: 'Start!',
    packHint: 'Have a "vanilla asset pack"? Import it for the original Minecraft look.',
    packImport: 'Import assets',
    name: 'Name',
    personality: 'Personality',
    language: 'Language',
    sound: 'Sound',
    'sound.bright': 'Bright',
    'sound.soft': 'Soft',
    'sound.off': 'Off',
    soundNeed: 'Import an asset pack with sounds to hear the {a}.',
    glow: 'Glowing outline',
    on: 'On',
    off: 'Off',
    days: 'Day {d} together　Bond: {lv}',
    counts: 'Fed {f}　Petted {p}　Played {g}',
    'aff.0': 'New friend',
    'aff.1': 'Familiar',
    'aff.2': 'Good friends',
    'aff.3': 'Inseparable',
    saveLabel: 'Save (stored on this device)',
    saveExport: 'Export save',
    saveImport: 'Restore save',
    packLabel: 'Vanilla assets',
    packApplied: 'Using Minecraft {v} assets (only on this device)',
    packNone: 'Using placeholder art. Import a "vanilla asset pack" for the original Minecraft look.',
    packReimport: 'Re-import',
    packRemove: 'Remove assets',
    reset: 'Start over (erase save)',
    resetConfirm: 'Erase the save and start over? Exporting it first is recommended.',
    done: 'Done',
    friendsMax: 'You can have up to {n} friends',
    friendsWait: 'The amethyst is recharging. Wait {n} more min',
    packImporting: 'Importing asset pack…',
    packDone: 'Minecraft {v} assets applied',
    saveTitle: 'FairyPocket save',
    saveExported: 'Save exported',
    saveDownloaded: 'Save downloaded',
    saveConfirm: 'Overwrite your progress with the save of "{n}"?',
    saveRestored: 'Save restored',
    offline: 'Ready to play offline',
    featherMiss: 'Tap the {a} to tickle it',
    defaultName: 'Ally',
  },
} satisfies Record<Lang, Record<string, string>>;

export type UiKey = keyof (typeof UI)['zh_tw'];

/** 測試用：各語言的介面文字鍵 */
export function uiKeys(l: Lang): string[] {
  return Object.keys(UI[l]);
}

/** 取介面文字；{a} 會自動換成悅靈的名稱，其餘 {x} 由 vars 提供 */
export function t(key: UiKey, vars: Record<string, string | number> = {}): string {
  return UI[lang][key].replace(/\{(\w+)\}/g, (_, k: string) => (k === 'a' ? ITEMS[lang].allay : String(vars[k] ?? '')));
}
