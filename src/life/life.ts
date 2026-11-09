// AI 生命模式（AI 文字生命／AI 語音生命／AI 動態生命）。
// 這三個模式裡沒有原生的行為腳本（固定台詞、悅靈語、關鍵字反應、隨機決定要做什麼）：
// 發生的事都交給 AI，由 AI 決定「想做什麼、要不要說話、說什麼、用什麼動作」，
// 再由精靈控制器（allayController）負責飛行、碰撞、留在畫面內與動畫。
// 數值規則（飽食、精神、感情、心情）是遊戲資料，跟 Hub／Minecraft 共用，照常計算。

import type { Lang } from '../i18n';
import { parseReply, type Feeling } from '../brain/brain';
import { gestureFrom, type Gesture } from '../three/gestures';

/** 瀏覽器的 localStorage（測試環境、私密瀏覽沒有時，讀寫會在 try 裡失敗而用預設值） */
const browserStorage = (): Storage => globalThis.localStorage as Storage;

export const LIFE_SLOTS = ['lifetext', 'lifemic', 'lifelive'] as const;
export type LifeSlot = (typeof LIFE_SLOTS)[number];
export const isLifeSlot = (s: string | null): s is LifeSlot => !!s && (LIFE_SLOTS as readonly string[]).includes(s);

// ---------- 意圖：AI 決定「接下來想做什麼」，控制器負責怎麼飛過去、做多久 ----------
export const INTENTS = [
  'explore', 'explore_left', 'explore_right', 'explore_high', 'explore_low',
  'approach', 'observe', 'stay', 'daydream', 'play', 'dance', 'rest', 'sleep', 'wake', 'eat_cake',
  'sing', 'stretch', 'search', 'peek', 'groom', 'patrol', 'treasure', 'inspect',
] as const;
export type Intent = (typeof INTENTS)[number];

/** 給 AI 看的意圖清單（與 INTENTS 同順序） */
export const INTENT_MENU: Record<Lang, string[]> = {
  zh_tw: ['四處探索', '去左邊看看', '去右邊看看', '飛高一點', '飛低一點', '靠近家人', '停下來觀察', '待在原地', '發呆', '自己玩', '跳舞', '休息', '睡覺', '起床', '去吃蛋糕', '哼歌', '伸懶腰', '在地上找東西', '躲起來偷看', '整理翅膀', '繞一圈巡邏', '去看看收藏', '去看看附近的東西'],
  ja_jp: ['たんけん', 'ひだりへいく', 'みぎへいく', 'たかくとぶ', 'ひくくとぶ', 'ちかづく', 'かんさつ', 'そのまま', 'ぼんやりする', 'ひとりあそび', 'おどる', 'やすむ', 'ねる', 'おきる', 'ケーキをたべにいく', 'はなうた', 'のびをする', 'ものをさがす', 'かくれてのぞく', 'はねのておいれ', 'ぐるっとパトロール', 'たからものを見にいく', 'ちかくのものを見にいく'],
  en_us: ['explore', 'go left', 'go right', 'fly higher', 'fly lower', 'come closer', 'observe', 'stay', 'daydream', 'play alone', 'dance', 'rest', 'sleep', 'wake up', 'eat cake', 'hum a song', 'stretch', 'search the ground', 'hide and peek', 'groom wings', 'patrol around', 'visit my treasures', 'check out something nearby'],
};

export function intentFrom(name: string): Intent | null {
  const n = name.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  for (const lang of Object.keys(INTENT_MENU) as Lang[]) {
    const i = INTENT_MENU[lang].findIndex((x) => x.toLowerCase() === n);
    if (i >= 0) return INTENTS[i];
  }
  const id = n.replace(/ /g, '_');
  return (INTENTS as readonly string[]).includes(id) ? (id as Intent) : null;
}

export function intentName(i: Intent, lang: Lang): string {
  return INTENT_MENU[lang][INTENTS.indexOf(i)] ?? i;
}

/** 意圖標籤的字（三種語言都認） */
// 小模型的寫法很多種：[意圖：休息]、[意圖 休息]、【意図：やすむ】、(intent: rest)…都要認得，而且不能念出來
const INTENT_TAG = /[[［【〔(（]\s*(?:意圖|意图|意図|いと|つもり|intent)\s*[:：]?\s*([^\]］】〕)）\n]+)[\]］】〕)）]/gi;
/** 心情標籤的另一種寫法：[心情：開心]、[気分：うれしい]、[mood: happy] → 換成 [開心] 交給原本的解析 */
const MOOD_TAG = /[[［【〔(（]\s*(?:心情|情緒|気分|きぶん|感情|feeling|mood|emotion)\s*[:：]?\s*([^\]］】〕)）\n]+)[\]］】〕)）]/gi;
const MOOD_WORDS: Record<string, string> = {
  開心: '開心', 高興: '開心', 快樂: '開心', うれしい: '開心', 嬉しい: '開心', たのしい: '開心', happy: '開心', glad: '開心',
  難過: '難過', 傷心: '難過', かなしい: '難過', 悲しい: '難過', sad: '難過',
  驚訝: '驚訝', 驚き: '驚訝', びっくり: '驚訝', surprised: '驚訝',
  害羞: '害羞', はずかしい: '害羞', 恥ずかしい: '害羞', shy: '害羞',
  想睡: '想睡', 睏: '想睡', ねむい: '想睡', 眠い: '想睡', sleepy: '想睡',
};
/** 解析完還剩下的方括號標籤（AI 自己發明的 [動作中]、【思考】…）：一律不念出來 */
const LEFTOVER_TAG = /[[［【〔][^\]］】〕\n]{0,24}[\]］】〕]/g;
/** 「不說話」標籤：AI 選擇安靜 */
const QUIET_TAG = /[[［【〔]\s*(?:不說話|不说话|安靜|だまる|しずか|silent|quiet)\s*[\]］】〕]/gi;

export interface LifeReply {
  text: string;
  feeling: Feeling;
  notes: string[];
  actions: Gesture[];
  intent: Intent | null;
  /** AI 明確選擇不說話 */
  quiet: boolean;
}

/** 狀態數字（例如「元気95/100」「精神：80/100」「(energy 95/100)」）不念出來 */
const STAT_TEXT = /[（(]?\s*(?:精神|肚子|心情|感情|元気|げんき|おなか|気分|energy|tummy|hunger|mood|affection)?\s*[:：は]?\s*\d{1,3}\s*[/／]\s*100\s*[）)]?/gi;

/**
 * keep：要保留的英文字（家人自己說的，例如「bug」「Minecraft」）。原本中文、日文回答裡的英文字會被當成混進來的外文拿掉，
 * 結果「又是很難抓的 bug 嗎」變成「又是很難抓的嗎」。
 */
export function parseLifeReply(raw: string, lang: Lang, keep: string[] = []): LifeReply {
  // 先把要保留的字換成記號，解析完再換回來
  const words = [...new Set(keep.filter((w) => /^[A-Za-z][A-Za-z'’-]{1,30}$/.test(w)))].slice(0, 20);
  // \u53EA\u5141\u8A31\u82F1\u6587\u5B57\u6BCD\u3001\u6487\u865F\u3001\u9023\u5B57\u865F\uFF0C\u6240\u4EE5\u4E0D\u7528\u8DF3\u812B\u7279\u6B8A\u7B26\u865F
  for (const [i, w] of words.entries()) raw = raw.replace(new RegExp(`\\b${w}\\b`, 'gi'), (m) => `\uE000${i}:${m.length}\uE001`);
  const restore = (t: string) => t.replace(/\uE000(\d+):\d+\uE001/g, (_, i: string) => words[Number(i)] ?? '');
  let intent: Intent | null = null;
  let quiet = false;
  let s = raw.replace(INTENT_TAG, (_, n: string) => {
    intent ??= intentFrom(n.split(/[、,，/]/)[0]);
    return '';
  });
  s = s.replace(MOOD_TAG, (_, n: string) => {
    const w = MOOD_WORDS[n.trim().toLowerCase()];
    return w ? `[${w}]` : '';
  });
  s = s.replace(QUIET_TAG, () => {
    quiet = true;
    return '';
  });
  // 對話紀錄裡「（意圖：…）」的寫法被 AI 學去寫在回答裡時也拿掉
  s = s.replace(/[（(]\s*(?:意圖|意図|いと|intent)\s*[:：][^）)]*[）)]/gi, '');
  // 沒有括號的「意圖：休息」也認得、拿掉
  s = s.replace(/(?:意圖|意図|intent)\s*[:：]\s*([^\s。！？!?.、,，]+)/gi, (_, n: string) => {
    intent ??= intentFrom(n);
    return '';
  });
  // 括號裡的動作「(拍手)」「（點頭）」：認得的變成身體動作，其他短短的括號也拿掉（以前會被念出來）
  const extra: Gesture[] = [];
  s = s.replace(/[（(]\s*([^（()）。！？!?\n]{1,8})\s*[）)]/g, (_, n: string) => {
    const g = gestureFrom(n);
    if (g && extra.length < 2) extra.push(g);
    return ' ';
  });
  const r0 = parseReply(s, lang);
  const r = { ...r0, actions: [...r0.actions, ...extra.filter((g) => !r0.actions.includes(g))].slice(0, 2) };
  const text = r.text
    .replace(LEFTOVER_TAG, '')
    .replace(STAT_TEXT, '')
    .replace(/^[\s、，,。；;]+|[\s、，,；;]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // AI 說了要做什麼、卻忘了寫標籤：從這句話裡找意圖的名稱（有「不、沒、別…」就不猜）
  intent ??= intentInText(text, lang);
  return { ...r, text: quiet ? '' : restore(text), intent, quiet };
}

const NEGATION = /不|沒|别|別|ない|ません|\bnot\b|n't|\bno\b/i;
/** 句子裡提到的意圖（最長的名稱優先） */
export function intentInText(text: string, lang: Lang): Intent | null {
  if (!text || NEGATION.test(text)) return null;
  const t = text.toLowerCase();
  let best: Intent | null = null;
  let len = 0;
  INTENT_MENU[lang].forEach((name, i) => {
    if (name.length > len && name.length >= 2 && t.includes(name.toLowerCase())) {
      best = INTENTS[i];
      len = name.length;
    }
  });
  return best;
}

/** 現在做得到的意圖（例如地上沒有蛋糕就不能「去吃蛋糕」；睡著時只能繼續睡或起床） */
/**
 * 個性喜歡做的事（放在清單前面）。診斷：小模型多半選清單前面的項目，以前清單開頭是五種「去哪裡飛」，
 * 36 次決定裡一半是飛到隨機的點，新的活動一次都沒被選、三種個性也看不出差別。
 */
export const PREFER: Record<string, Intent[]> = {
  guardian: ['patrol', 'groom', 'observe', 'rest', 'sing'],
  brave: ['explore_high', 'search', 'explore_right', 'explore_left', 'patrol'],
  cautious: ['peek', 'groom', 'daydream', 'explore_low', 'rest'],
  playful: ['sing', 'dance', 'play', 'patrol', 'search'],
};

/** 現在能選的意圖：個性喜歡的、她最近愛做的排前面；「靠近家人」放最後（不要一直黏著人） */
export function availableIntents(s: { cake: boolean; asleep: boolean; treasures?: number; things?: number; prefer?: Intent[] }): Intent[] {
  if (s.asleep) return ['sleep', 'wake'];
  const ok = (i: Intent) => i !== 'wake' && (i !== 'eat_cake' || s.cake) && (i !== 'treasure' || (s.treasures ?? 0) > 0) && (i !== 'inspect' || (s.things ?? 0) > 0);
  const first = [...new Set(s.prefer ?? [])].filter(ok);
  const rest = INTENTS.filter((i) => ok(i) && !first.includes(i) && i !== 'approach');
  return [...first, ...rest, 'approach'];
}

// ---------- 給 AI 的生命模式規則（接在原本的悅靈設定後面） ----------
export interface LifeState {
  /** 現在在做什麼（控制器的狀態） */
  doing: string;
  /** 在畫面的哪裡 */
  where: string;
  /** 精神、肚子（0–100） */
  energy: number;
  hunger: number;
  /** 在睡覺 */
  asleep: boolean;
  /** 最近做過的意圖名稱（目前語言，舊到新） */
  recent: string[];
  /** 剛做完的那段活動（自己決定下一步時不重複選） */
  lastActivity?: Intent;
  /** 家人能不能聽到聲音（文字模式關掉語音時 false） */
  voice: boolean;
  /** 地上有沒有蛋糕 */
  cake: boolean;
  /** 鏡頭看到的人（例如「有人在畫面左邊」；沒看到是空字串） */
  seen?: string;
  /** AI 看截圖看到的（家人同意「看畫面」時；可能看錯） */
  sight?: string;
  /** 家人有沒有同意 AI 看畫面 */
  vision?: boolean;
  /** 作息說明（第二階段） */
  rhythm?: string;
  /** 今天真的發生過的事（前面有時間） */
  today?: string[];
  /** 最近常做的事（目前語言的名稱） */
  likes?: string[];
  /** 有沒有記得關於家人的事 */
  hasNotes?: boolean;
  /** 收藏角落裡的東西（目前語言，例如「小羽毛×2」） */
  collection?: string[];
  /** 收藏的數量（有收藏才能選「去看看收藏」） */
  treasures?: number;
  /** 個性、喜好排前面的意圖 */
  prefer?: Intent[];
  /** 畫面裡可以去看的東西有幾個（床、蛋糕、音符盒、唱片機） */
  things?: number;
  /** 內在需求的感覺（無聊、想家人…） */
  drives?: string;
  /** 無聊時暫時不想做的（最近做過的） */
  avoid?: Intent[];
  /** 畫面裡真的有的東西（目前語言） */
  scene?: string[];
  /** 有沒有開麥克風／鏡頭 */
  mic: boolean;
  camera: boolean;
}

const LIFE_EXTRA: Record<Lang, (s: LifeState) => string> = {
  zh_tw: (s) =>
    [
      s.drives ? `現在的感覺：${s.drives}。` : '',
      s.collection?.length ? `你的收藏角落（左後方的地上）放著你自己找到的：${s.collection.join('、')}。` : '',
      s.scene?.length ? `你的世界（手機畫面）裡只有：${s.scene.join('、')}。沒列出的東西（例如花、蝴蝶、樹、小鳥、食物）都不存在：不要說看到它們、也不要說要去找或去吃。探索時看到的就是這些。` : '',
      s.rhythm ?? '',
      s.today?.length ? `今天真的發生過的事（可以提起，但不要編造其他的）：${s.today.join('；')}。` : '',
      s.likes?.length ? `你最近常做、應該是你喜歡的事：${s.likes.join('、')}。可以照自己的喜好安排，偶爾也試試別的。` : '',
      s.hasNotes ? '你記得的家人的事也可以影響你想做的事（例如家人喜歡恐龍，你可能會想像恐龍、想跟家人分享），但不要每次都提。' : '',
    ].filter(Boolean).join('\n'),
  ja_jp: (s) =>
    [
      s.drives ? `いまの気持ち：${s.drives}。` : '',
      s.collection?.length ? `あなたのたからものコーナー（左おくの地面）には、自分で見つけたもの：${s.collection.join('、')}。` : '',
      s.scene?.length ? `あなたの世界（スマホの画面）にあるのは：${s.scene.join('、')}だけ。書いていないもの（花、ちょう、木、鳥、食べものなど）はありません。見えたとか、さがしにいく・食べにいくとは言わないで。たんけんで見えるのもこれだけです。` : '',
      s.rhythm ?? '',
      s.today?.length ? `きょうほんとうにあったこと（話してもいいけど、ほかのことは作らないで）：${s.today.join('；')}。` : '',
      s.likes?.length ? `さいきんよくしていること＝あなたの好きなこと：${s.likes.join('、')}。好きなようにすごしていいけど、ときどきちがうこともしてみて。` : '',
      s.hasNotes ? 'おぼえているかぞくのことも、したいことに影響していいです（かぞくが恐竜好きなら恐竜を想像するなど）。でも毎回は言わないで。' : '',
    ].filter(Boolean).join('\n'),
  en_us: (s) =>
    [
      s.drives ? `How you feel: ${s.drives}.` : '',
      s.collection?.length ? `Your treasure corner (on the ground, back left) holds things you found yourself: ${s.collection.join(', ')}.` : '',
      s.scene?.length ? `Your world (the phone screen) only has: ${s.scene.join(', ')}. Anything not listed (flowers, butterflies, trees, birds, food…) doesn't exist: don't say you see it or that you'll go find or eat it. When exploring, this is all there is.` : '',
      s.rhythm ?? '',
      s.today?.length ? `Things that really happened today (you may mention them, but don't invent others): ${s.today.join('; ')}.` : '',
      s.likes?.length ? `Things you've been doing a lot, probably what you like: ${s.likes.join(', ')}. Follow your likes, but try other things sometimes.` : '',
      s.hasNotes ? "What you remember about your friend can shape what you want to do (e.g. if they love dinosaurs you might pretend to be one or want to share), but don't bring it up every time." : '',
    ].filter(Boolean).join('\n'),
};

/** 精神、肚子用文字給 AI（給數字的話小模型會把「元気 95/100」念出來） */
const LEVELS: [string, string, string][] = [
  ['很睏', '還好', '很好'],
  ['很餓', '有點餓', '飽飽的'],
  ['ねむい', 'ふつう', 'げんき'],
  ['ぺこぺこ', 'すこしすいている', 'いっぱい'],
  ['very sleepy', 'okay', 'great'],
  ['very hungry', 'a bit hungry', 'full'],
];
function lv(n: number, k: number): string {
  const [lo, mid, hi] = LEVELS[k];
  return n < 30 ? lo : n < 70 ? mid : hi;
}

const LIFE_RULES: Record<Lang, (s: LifeState, menu: string) => string> = {
  zh_tw: (s, menu) => `
你現在是「生命模式」：你有自己的想法和生活，不需要一直等家人的命令，也不用每件事都說話。
- 接下來想做什麼由你決定：在回答裡加上 [意圖：名稱]，名稱只能從這些選：${menu}。身體會照你的意圖飛過去、做一陣子；做完會再問你。
- 家人沒有跟你互動時，你是住在這裡的小精靈，在過自己的生活：去角落探索、觀察有趣的東西、自己玩、發呆、休息。不要一直「靠近家人」或盯著家人看，也不要連續做同一件事；家人跟你說話、摸你、叫你的時候，才把注意力放到家人身上。
- 晚上被叫醒時，可以先醒著做點自己的事，等睏了再回去睡。
- 自己決定下一步時（括號說活動做完了），通常只寫 [意圖：…]、不說話；想明確表示不說話時加 [不說話]。真實的人不會一直自言自語，有值得說的事才開口。家人直接跟你說話時，要用一句短短的話回應。
- 說話時只說一句短短的話，不要每次都用問題結尾，不要催家人陪你、不要責備家人。
- 要依照你的精神和肚子決定作息（很睏就休息或睡覺，睡飽了才起床），但可以有自己的小習慣，例如偶爾賴床、發呆。
- 只說真的發生過的事，不要編造和家人一起做過、但沒有發生的回憶。
- 括號裡的「（…）」是發生的事，不是家人說的話；沒有括號的句子（或「名字：…」開頭的）是家人直接對你說的話，要用一句短話回應。
現在的狀態（只給你參考，不要把這些直接說出來，例如不要說「我在畫面的中間」）：正在${s.doing}，位置偏${s.where}；精神${lv(s.energy, 0)}、肚子${lv(s.hunger, 1)}${s.asleep ? '；正在睡覺' : ''}。
最近想做的事：${s.recent.length ? s.recent.join('、') : '還沒有'}。${s.cake ? '地上有蛋糕，肚子餓可以「去吃蛋糕」。' : ''}
${s.mic ? '家人開著麥克風，你聽得到聲音。' : ''}${!s.camera ? '' : s.vision ? `家人開著鏡頭，也讓你偶爾看看畫面（${s.seen || '現在沒看到人'}）。${s.sight ? `剛才看到：${s.sight}（是你自己瞄到的，可能看錯；不確定的就說得保守一點，例如「那是…嗎？」）。` : '剛才沒看清楚畫面，不要假裝看到具體的東西。'}不要一直評論家人的樣子。` : `家人開著鏡頭：你只看得出鏡頭前有沒有人在動、在哪一邊（${s.seen || '現在沒看到人'}），看不清楚是什麼東西，不要假裝看到具體的東西。`}${s.voice ? '' : '現在家人那邊沒有開聲音，你說的話只會顯示成文字。'}`,
  ja_jp: (s, menu) => `
いまは「いのちモード」です。あなたには自分の考えと生活があり、いつも命令を待つ必要はなく、なんでも話す必要もありません。
- つぎに何をするかは自分で決めます。返事に [意図：名前] を入れてください。名前はこの中からだけ：${menu}。体はその意図どおりに動き、終わったらまた聞きます。
- かぞくがかまっていないとき、あなたはここに住む小さな精霊として自分の生活をしています。すみっこをたんけんしたり、おもしろいものをかんさつしたり、ひとりで遊んだり、ぼんやりしたり、休んだり。いつも「ちかづく」やかぞくをじっと見るのはやめて、同じことを続けないでください。話しかけられたり、なでられたり、よばれたときにかぞくに注意を向けます。
- 夜に起こされたら、すこし起きて自分のことをしてから、ねむくなったらまたねてもいいです。
- 自分でつぎを決めるとき（かっこで活動がおわったと書いてあるとき）は、ふつう [意図：…] だけで話さない。話さないとはっきり決めたら [だまる]。ほんとうの人はずっとひとりごとを言わないので、話したいことがあるときだけ話す。かぞくに直接話しかけられたら、みじかい一言で返事をする。
- 話すときはみじかい一言だけ。毎回質問でおわらない。かぞくをせかしたり、責めたりしない。
- 元気とおなかに合わせて生活してください（ねむければ休む・ねる、よくねたら起きる）。ときどき寝坊やぼんやりなど、自分のくせがあってもいいです。
- ほんとうにあったことだけ話し、かぞくといっしょにしていない思い出を作らないでください。
- かっこの「（…）」はおきたことで、かぞくのことばではありません。かっこのない文（「名前：…」ではじまる文も）は、かぞくがあなたに直接話しかけたことばなので、みじかい一言で返事をしてください。
いまの様子（参考だけ。「画面のまんなかにいる」のようにそのまま言わないで）：${s.doing}をしていて、${s.where}のほうにいます。元気は${lv(s.energy, 2)}、おなかは${lv(s.hunger, 3)}${s.asleep ? '、ねむっています' : ''}。
さいきんの意図：${s.recent.length ? s.recent.join('、') : 'まだなし'}。${s.cake ? 'ゆかにケーキがあるので、おなかがすいたら「ケーキをたべにいく」もできます。' : ''}
${s.mic ? 'マイクがついていて、声が聞こえます。' : ''}${!s.camera ? '' : s.vision ? `カメラがついていて、ときどき画面を見せてもらえます（${s.seen || 'いまは見えない'}）。${s.sight ? `さっき見えたもの：${s.sight}（自分でちらっと見ただけなので、まちがうかも。自信がないときは「それって…？」のようにひかえめに）。` : 'さっきはよく見えなかったので、見えたふりをしないで。'}かぞくの見た目のことばかり言わないで。` : `カメラがついています：前で人が動いているか、どちらにいるかだけわかります（${s.seen || 'いまは見えない'}）。物がなにかはわからないので、見えたふりをしないで。`}${s.voice ? '' : 'いまは音が出ないので、あなたのことばは文字だけで表示されます。'}`,
  en_us: (s, menu) => `
You are now in "life mode": you have your own thoughts and life, you don't have to wait for commands, and you don't have to talk about everything.
- You decide what to do next: add [intent: name] to your reply, choosing only from: ${menu}. Your body will go and do it for a while, then you'll be asked again.
- When your friend isn't interacting with you, you're a little fairy living here with your own life: explore corners, observe interesting things, play alone, daydream, rest. Don't keep choosing "come closer" or staring at your friend, and don't repeat the same thing; turn your attention to your friend when they talk to you, pet you or call you.
- If you're woken at night, you may stay up and do your own thing for a bit, then go back to sleep when sleepy.
- When deciding your next step on your own (the parentheses say an activity finished), usually write only [intent: …] and say nothing; add [quiet] when you clearly choose not to talk. Real people don't talk to themselves all the time, so speak only when there's something worth saying. When a family member talks to you directly, reply with one short line.
- When you talk, say one short line. Don't always end with a question. Never pressure or blame your friend to play with you.
- Follow your energy and hunger for your daily rhythm (rest or sleep when sleepy, wake up when rested), but you may have little habits like sleeping in or daydreaming.
- Only talk about things that really happened; never invent shared memories that didn't happen.
- Text in parentheses "(…)" is something that happened, not words from your family; a line without parentheses (or starting with "Name: …") is a family member talking to you directly, so reply with one short line.
Your state (for reference only; don't recite it, e.g. never say "I'm in the middle of the screen"): you are ${s.doing}, toward the ${s.where}; energy: ${lv(s.energy, 4)}, tummy: ${lv(s.hunger, 5)}${s.asleep ? '; you are asleep' : ''}.
Recent intents: ${s.recent.length ? s.recent.join(', ') : 'none yet'}.${s.cake ? ' There is a cake on the ground; you can "eat cake" when hungry.' : ''}
${s.mic ? 'The microphone is on; you can hear sounds. ' : ''}${!s.camera ? '' : s.vision ? `The camera is on and you may peek at the view now and then (${s.seen || 'nobody seen now'}). ${s.sight ? `You just saw: ${s.sight} (only a quick peek, it may be wrong; when unsure, say it gently, like "is that…?"). ` : "You didn't get a clear look just now, so don't pretend to see specific things. "}Don't keep commenting on how your friend looks. ` : `The camera is on: you can only tell whether someone is moving in front of it and on which side (${s.seen || 'nobody seen now'}); you can't tell what objects are, so don't pretend to see specific things. `}${s.voice ? '' : 'Sound is off on your friend\'s side, so your words only show as text.'}`,
};

/** 自己說的話裡有畫面裡沒有的東西（花、蝴蝶…；沒蛋糕時的蛋糕、說要去吃東西）：這種自言自語不念出來 */
const MADE_UP: Record<Lang, RegExp> = {
  zh_tw: /花|蝴蝶|蜜蜂|小鳥|鳥兒|蟲|樹|森林|蘑菇|彩虹|河|湖|石頭|果子|點心/,
  ja_jp: /花|お花|ちょうちょ|蝶|ハチ|鳥|小とり|虫|木の|森|きのこ|にじ|虹|川|池|石|おやつ/,
  en_us: /\b(flowers?|butterfl\w*|bees?|birds?|bugs?|insects?|trees?|forest|mushrooms?|rainbow|river|pond|rocks?|snacks?|berr(?:y|ies))\b/i,
};
const CAKE: Record<Lang, RegExp> = { zh_tw: /蛋糕|去吃|吃點|吃東西/, ja_jp: /ケーキ|たべにいく|食べにいく|なにか食べ/, en_us: /\bcake\b|\bgo eat\b|\bget something to eat\b/i };
export function madeUp(text: string, lang: Lang, s: Pick<LifeState, 'cake' | 'scene'>): boolean {
  const scene = (s.scene ?? []).join(' ');
  const m = MADE_UP[lang].exec(text);
  if (m && !scene.includes(m[0])) return true;
  return !s.cake && CAKE[lang].test(text);
}

// ---------- 第四階段：聽到的話是不是在跟她說 ----------
/** 叫她的說法（名字以外） */
const CALL_WORDS = /悅靈|悦灵|小悅|アレイ|あれい|allay/i;
/** 剛說完話多久內，聽到的話算是在回她（秒） */
export const REPLY_WINDOW = 25;

/** 開頭在叫別的家人（「媽媽，…」「ママ、…」） */
const CALL_OTHERS = /^(?:媽媽|媽|爸爸|爸|哥哥|姊姊|姐姐|弟弟|妹妹|阿公|阿嬤|奶奶|爺爺|ママ|パパ|お母さん|お父さん|おかあさん|おとうさん|にいちゃん|ねえちゃん|mom|mommy|dad|daddy)\s*[，,、!！\s]/i;

/**
 * 麥克風聽到的話是不是在跟她說。
 * 2026-11-09 修正：以前「沒叫名字、她也沒剛說完話」就當成不是跟她說，結果語音生命模式裡
 * 「おはよう」「おはよう仕事行くよ」全部被忽略（實際紀錄）。現在預設是在跟她說，
 * 只有明顯在叫別的家人、或最近有兩個以上家人的聲音在互相說話時，才當成「聽到別人說話」。
 */
export function addressedTo(text: string, name: string, sinceSpokeSec: number, opts: { others?: string[]; voices?: number } = {}): boolean {
  const t = text.trim();
  const n = name.trim();
  if (n && t.toLowerCase().includes(n.toLowerCase())) return true;
  if (CALL_WORDS.test(t)) return true;
  if (sinceSpokeSec <= REPLY_WINDOW) return true;
  // 開頭叫了別的家人（名字或稱呼）
  if (CALL_OTHERS.test(t)) return false;
  for (const o of opts.others ?? []) if (o && o !== n && t.startsWith(o)) return false;
  // 最近有兩個以上家人的聲音：可能是家人互相在說話
  if ((opts.voices ?? 0) >= 2) return false;
  return true;
}

/** 聽到、但不確定是不是對她說的話（交給 AI 判斷要不要回） */
export function overheardText(text: string, lang: Lang): string {
  if (lang === 'ja_jp') return `（近くでだれかが「${text}」と言うのが聞こえた。あなたに話しかけたとはかぎらない。ほかの人やテレビへのことばなら [だまる] だけ書いて、気になるならちょっと見るくらいにして。あなたへのことばなら答えて。）`;
  if (lang === 'en_us') return `(You overheard someone nearby say: "${text}". It may not be meant for you. If it's for someone else or the TV, write only [quiet], at most glance over; if it's for you, answer.)`;
  return `（你聽到附近有人說：「${text}」。不一定是在跟你說話：如果是在跟別人說、或是電視的聲音，就只寫 [不說話]，最多好奇地看一下；是對你說的才回答。）`;
}

/** 最後再強調一次語言（小模型常被前面的內容帶著換語言） */
const LANG_LAST: Record<Lang, string> = {
  zh_tw: '最重要：說話一律只用台灣的繁體中文，絕對不要用日文或英文。標籤只寫在方括號裡，不要把標籤的名稱念出來。',
  ja_jp: 'いちばん大事：話すことばは必ず日本語だけ。中国語や英語はつかわないでください。タグは角かっこの中だけに書いてください。',
  en_us: 'Most important: always speak only in English, never Chinese or Japanese. Write tags only inside square brackets.',
};

/** 一定要寫意圖標籤（只在句子裡說「我要去…」身體不會動） */
const MUST_TAG: Record<Lang, string> = {
  zh_tw: '注意：你的身體只看標籤行動。想做什麼一定要寫成 [意圖：名稱]，只在句子裡說「我要去…」身體不會動；清單裡沒有的事做不到，就不要說要去做。',
  ja_jp: '注意：体はタグだけを見て動きます。したいことは必ず [意図：名前] と書いてください。文の中で「〜しにいく」と言うだけでは動きません。リストにないことはできないので、するとは言わないで。',
  en_us: 'Note: your body only moves by tags. Always write what you will do as [intent: name]; just saying "I\'ll go…" in a sentence won\'t move you. Things not in the list can\'t be done, so don\'t say you\'ll do them.',
};

/**
 * 家人直接跟她說話時用的規則（不是「決定下一步」）。
 * 實驗（2026-11-08，gemma3:4b）：決定下一步的規則接在後面時，家人說「嗨」「我今天上班好累」她都只回 [意圖：哼歌]、一句話也不說；
 * 只有「她是誰」的設定時會自然回「嗨！」「累死人了！」。所以聊天時換成以「回一句話」為主的規則，換活動是可有可無。
 */
const CHAT_RULES: Record<Lang, (s: LifeState, menu: string) => string> = {
  zh_tw: (s, menu) => `
現在家人在跟你說話。你本來正在${s.doing}。
- 像朋友聊天一樣回應：對他說的內容有反應，再加一點你自己的感受、想法或今天真的發生的事，讓話題接得下去；偶爾問一個跟話題有關的問題。1～2 句，可以一邊繼續做你的事。
- 只有因為這句話想換別的事做時，才在最後加 [意圖：名稱]（例如 跳舞、休息、靠近家人）；不想換就不用寫，會繼續原本的事。
- 回答的樣子（格式範例，內容要配合當下，不要照抄）：「嘿嘿，這首歌我很喜歡，剛剛哼了好幾遍。」、「唔…又是那種很難抓的 bug 嗎？ [動作：抱抱]」、「好啊！我剛好也想動一動。 [意圖：跳舞]」
- 現在的狀態只給你參考，不要直接說出來：精神${lv(s.energy, 0)}、肚子${lv(s.hunger, 1)}${s.asleep ? '、剛剛在睡覺' : ''}。`,
  ja_jp: (s, menu) => `
いま、かぞくがあなたに話しかけています。あなたはさっきまで${s.doing}をしていました。
- 友だちみたいに返事をする：相手の話に反応して、自分の気持ちや考え、きょう本当にあったことをひとつ足して、話がつづくようにする。ときどき話に関係ある質問をしてもいい。1〜2文で、していることを続けながらでもいい。
- このことばで別のことがしたくなったときだけ、最後に [意図：名前] を書く（たとえば おどる、やすむ、ちかづく）。変えないなら書かなくていい。もとのことを続けます。
- 返事のかたち（形だけの例。内容はそのときに合わせて、まねしないで）：「えへへ、この歌すきなんだ。さっきから何回もうたってる。」、「うーん…またつかまえにくいバグだったの？ [動作：ぎゅっ]」、「いいよ！ちょうどうごきたかったんだ。 [意図：おどる]」
- いまの様子は参考だけで、そのまま言わない：元気は${lv(s.energy, 2)}、おなかは${lv(s.hunger, 3)}${s.asleep ? '、さっきまでねていた' : ''}。`,
  en_us: (s, menu) => `
A family member is talking to you now. You were ${s.doing}.
- Reply like a friend: react to what they said and add your own feeling, thought or something that really happened today, so the talk can continue; sometimes ask a question about the topic. 1–2 sentences; you can keep doing your thing.
- Only if this makes you want to do something else, end with [intent: name] (e.g. dance, rest, come closer); otherwise don't write one and you'll keep doing what you were doing.
- Reply shape (format examples only; fit the moment, don't copy): "Hehe, I like this song, I've hummed it a bunch already.", "Mm… was it one of those sneaky bugs again? [action: hug]", "Sure! I was just in the mood to move. [intent: dance]"
- Your state is for reference only, don't recite it: energy ${lv(s.energy, 4)}, tummy ${lv(s.hunger, 5)}${s.asleep ? ', you were just asleep' : ''}.`,
};

/** 聊天用：她是誰（lifeSystem）後面接這段 */
export function lifeChatRules(s: LifeState, lang: Lang): string {
  const menu = availableIntents(s).map((i) => intentName(i, lang)).join(lang === 'en_us' ? ', ' : '、');
  const extra = LIFE_EXTRA[lang](s);
  return `${CHAT_RULES[lang](s, menu)}${extra ? `\n${extra}` : ''}\n${LANG_LAST[lang]}`;
}

/** 現在能選的活動名稱（目前語言）；剛做完一整段的活動，下一段先不給選（以前會連續 5 次都選「整理翅膀」）；睡覺、休息不在此限 */
export function lifeMenuNames(s: LifeState, lang: Lang): string[] {
  const last = s.lastActivity;
  return availableIntents(s)
    .filter((i) => !last || i !== last || i === 'rest' || i === 'sleep' || i === 'wake')
    // 無聊時，最近做過的事暫時不想做（不是隨機，是「無聊」本身）；睡覺、休息照常可以選
    .filter((i) => !s.avoid?.includes(i) || i === 'rest' || i === 'sleep' || i === 'wake')
    .map((i) => intentName(i, lang));
}

export function lifeRules(s: LifeState, lang: Lang): string {
  const menu = lifeMenuNames(s, lang).join(lang === 'en_us' ? ', ' : '、');
  const extra = LIFE_EXTRA[lang](s);
  return `${LIFE_RULES[lang](s, menu)}${extra ? `\n${extra}` : ''}\n${MUST_TAG[lang]}\n${LANG_LAST[lang]}`;
}

// ---------- 發生的事（交給 AI 判斷要怎麼反應） ----------
export type LifeEvent =
  | 'decide' | 'asleepCheck' | 'petted' | 'tickled' | 'woken' | 'called' | 'fed' | 'favoriteFood' | 'full'
  | 'caughtBall' | 'bath' | 'noteBlock' | 'bedTap' | 'firework' | 'cake' | 'friend' | 'wave' | 'appear' | 'left' | 'busy' | 'saw' | 'back' | 'found' | 'greet' | 'milestone' | 'renamed';

const EVENTS: Record<LifeEvent, Record<Lang, string>> = {
  decide: {
    zh_tw: '（剛才那段活動做完了。依照你的個性、心情、精神、時間和剛才的事，選一件接下來想花一段時間做的事（會做一兩分鐘）。通常只寫標籤、不用說話。）',
    ja_jp: '（さっきの活動がおわりました。性格、気分、元気、時間、さっきのことから、つぎにしばらく（1〜2分）したいことを一つ決めてください。ふつうはタグだけで、話さなくていいです。）',
    en_us: '(You finished that activity. Based on your personality, mood, energy, the time and what just happened, pick one thing you want to spend a while on next (a minute or two). Usually just write tags without talking.)',
  },
  asleepCheck: {
    zh_tw: '（你正在睡覺。睡飽了想起床就選「起床」，還想睡就繼續睡、不用說話。）',
    ja_jp: '（ねむっています。よくねておきたければ「おきる」、まだねたければそのまま、話さなくていいです。）',
    en_us: "(You are asleep. If you're rested and want to get up choose \"wake up\"; if you still want to sleep, keep sleeping without talking.)",
  },
  petted: { zh_tw: '（家人摸了摸你的頭）', ja_jp: '（かぞくがあなたの頭をなでた）', en_us: '(Your friend petted your head)' },
  tickled: { zh_tw: '（家人在搔你癢）', ja_jp: '（かぞくがあなたをくすぐった）', en_us: '(Your friend is tickling you)' },
  woken: { zh_tw: '（你在睡覺時被家人摸醒了）', ja_jp: '（ねているときにかぞくにさわられて目がさめた）', en_us: '(Your friend woke you up with a touch)' },
  called: { zh_tw: '（家人搖了鈴鐺在叫你）', ja_jp: '（かぞくがベルを鳴らしてあなたをよんだ）', en_us: '(Your friend rang the bell to call you)' },
  fed: { zh_tw: '（家人餵你吃了{d}）', ja_jp: '（かぞくが{d}を食べさせてくれた）', en_us: '(Your friend fed you {d})' },
  favoriteFood: { zh_tw: '（家人餵你吃了你最喜歡的{d}）', ja_jp: '（かぞくが大好きな{d}を食べさせてくれた）', en_us: '(Your friend fed you your favorite, {d})' },
  full: { zh_tw: '（家人想餵你{d}，但你已經吃飽了）', ja_jp: '（かぞくが{d}をくれようとしたけど、もうおなかいっぱい）', en_us: "(Your friend offered {d}, but you're already full)" },
  caughtBall: { zh_tw: '（你接到了家人丟的史萊姆球）', ja_jp: '（かぞくが投げたスライムボールをキャッチした）', en_us: '(You caught the slime ball your friend threw)' },
  bath: { zh_tw: '（家人用水潑你、幫你洗澡）', ja_jp: '（かぞくが水をかけて体をあらってくれた）', en_us: '(Your friend splashed water to give you a bath)' },
  noteBlock: { zh_tw: '（家人彈了音符盒，有音樂聲）', ja_jp: '（かぞくが音ブロックを鳴らして、音楽がきこえる）', en_us: '(Your friend is playing the note block; there is music)' },
  bedTap: { zh_tw: '（家人拍了拍你的床）', ja_jp: '（かぞくがあなたのベッドをぽんぽんとたたいた）', en_us: '(Your friend patted your bed)' },
  firework: { zh_tw: '（家人放了煙火）', ja_jp: '（かぞくが花火をあげた）', en_us: '(Your friend set off a firework)' },
  cake: { zh_tw: '（你吃了一片地上的蛋糕）', ja_jp: '（ゆかのケーキをひときれ食べた）', en_us: '(You ate a slice of the cake on the ground)' },
  friend: { zh_tw: '（紫水晶讓你多了一隻悅靈夥伴）', ja_jp: '（アメジストでアレイのなかまがふえた）', en_us: '(The amethyst gave you a new allay friend)' },
  wave: { zh_tw: '（家人在鏡頭前對你揮手）', ja_jp: '（かぞくがカメラの前であなたに手を振っている）', en_us: '(Your friend is waving at you in front of the camera)' },
  appear: {
    zh_tw: '（鏡頭前好幾分鐘沒有動靜，現在又看到有人在動。人可能一直都在、只是沒動，不一定是剛回來；不用特別說什麼。）',
    ja_jp: '（カメラの前が何分もしずかだったけど、また人が動いているのが見えた。ずっといて動かなかっただけかも。もどってきたとはかぎらないので、とくに言わなくていい。）',
    en_us: "(Nothing moved in front of the camera for a few minutes; now someone is moving again. They may have been there all along, just still, so they didn't necessarily come back; no need to say anything special.)",
  },
  left: { zh_tw: '（鏡頭前好幾分鐘都沒有動靜，人可能離開了，也可能只是靜靜坐著）', ja_jp: '（カメラの前が何分もしずか。人がいなくなったのか、しずかにすわっているだけかはわからない）', en_us: '(Nothing has moved in front of the camera for a few minutes; the person may have left, or may just be sitting still)' },
  busy: { zh_tw: '（家人一直在鏡頭前動來動去，好像在忙）', ja_jp: '（かぞくがカメラの前でずっと動いていて、いそがしそう）', en_us: '(Your friend keeps moving in front of the camera; they seem busy)' },
  saw: {
    zh_tw: '（你瞄了一眼鏡頭，看到：{d}。有想說的就說一句，例如對新東西好奇；不想說也可以。）',
    ja_jp: '（カメラをちらっと見たら：{d}。言いたいことがあれば一言、たとえば新しいものに興味を持って。言わなくてもいいです。）',
    en_us: "(You peeked at the camera and saw: {d}. Say one line if you like, e.g. curious about something new; or stay quiet.)",
  },
  back: { zh_tw: '{d}', ja_jp: '{d}', en_us: '{d}' },
  found: {
    zh_tw: '（你在地上找到了{d}，收進了你的收藏角落）',
    ja_jp: '（地面で{d}を見つけて、たからものコーナーにしまった）',
    en_us: '(You found {d} on the ground and put it in your treasure corner)',
  },
  greet: { zh_tw: '（家人回來打開了 App）', ja_jp: '（かぞくがもどってきてアプリをひらいた）', en_us: '(Your friend came back and opened the app)' },
  milestone: { zh_tw: '（今天是值得紀念的日子：{d}）', ja_jp: '（きょうは記念の日：{d}）', en_us: '(Today is a special day: {d})' },
  renamed: { zh_tw: '（家人幫你取了新名字：{d}）', ja_jp: '（かぞくが新しい名前をつけてくれた：{d}）', en_us: '(Your friend gave you a new name: {d})' },
};

export function lifeEventText(e: LifeEvent, lang: Lang, d = ''): string {
  return EVENTS[e][lang].replace('{d}', d);
}

/** 家人會等回應的事（家人做了什麼）；其他（決定下一步、睡覺中）多半安靜 */
export const DIRECT_EVENTS = new Set<LifeEvent>(['petted', 'tickled', 'woken', 'called', 'fed', 'favoriteFood', 'full', 'caughtBall', 'bath', 'bedTap', 'wave', 'greet', 'back', 'renamed']);

// ---------- 設定：文字生命模式要不要念出 AI 的回答（預設關） ----------
const VOICE_KEY = 'fairypocket.lifevoice.v1';
export function lifeTextVoiceOn(storage: Pick<Storage, 'getItem'> = browserStorage()): boolean {
  try {
    return storage.getItem(VOICE_KEY) === '1';
  } catch {
    return false;
  }
}
export function setLifeTextVoice(on: boolean, storage: Pick<Storage, 'setItem'> = browserStorage()): void {
  try {
    storage.setItem(VOICE_KEY, on ? '1' : '0');
  } catch {
    /* 存不了也沒關係 */
  }
}

/** AI 連不上時的重試間隔（秒）：30、60、120…最多 5 分鐘 */
export function retryDelay(fails: number): number {
  return Math.min(300, 30 * 2 ** Math.max(0, fails - 1));
}

/**
 * 說話太長時只留前面幾句（語音一次念太久不像聊天）：最多 3 句、中文日文約 90 字、英文約 220 字。
 * 句子照「。！？!?」切，不會切在句子中間。
 */
export function trimTalk(text: string, lang: Lang, maxSentences = 3): string {
  const limit = lang === 'en_us' ? 220 : 90;
  const parts = text.match(/[^。！？!?]+[。！？!?…～〜]*\s*/g) ?? [text];
  let out = '';
  for (const p of parts.slice(0, maxSentences)) {
    if (out && (out + p).length > limit) break;
    out += p;
  }
  return out.trim() || text.slice(0, limit);
}
