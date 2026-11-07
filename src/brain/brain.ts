// 悅靈的 AI 大腦（第二層）：家裡電腦的本機 AI（Ollama），透過 Tailscale 連線。
// 規則（talk.ts、assist）聽得懂的話照舊由規則回答；聽不懂的才問 AI。
// AI 會帶著悅靈的名字、個性、心情、和你的回憶與最近的對話，所以說話像同一隻悅靈。
// 對話與記住的事只存在這台裝置（會跟著備份），送到的地方只有你自己家裡的電腦。

import { getSecret, putSecret } from '../secureStore';
import type { Lang } from '../i18n';
import { FOODS, type Food, type PetState } from '../game/state';
import { GESTURE_MENU, gestureFrom, type Gesture } from '../three/gestures';

const CFG_KEY = 'fairypocket.brain.v1';
const MEM_KEY = 'fairypocket.brain.mem.v1';

export interface BrainConfig {
  on: boolean;
  /** 例如 https://desktop-xxxx.tailxxxx.ts.net */
  url: string;
  model: string;
  /** 通行碼（電腦的 private/ai-token.txt） */
  token: string;
}

export const DEFAULT_MODEL = 'gemma3:4b';

function normalize(c: Partial<BrainConfig> | null): BrainConfig {
  return {
    on: !!c?.on,
    url: typeof c?.url === 'string' ? c.url : '',
    model: typeof c?.model === 'string' && c.model ? c.model : DEFAULT_MODEL,
    token: typeof c?.token === 'string' ? c.token : '',
  };
}

/** 連線設定（網址、通行碼）加密存在這台裝置（見 secureStore.ts）；啟動時解密一次放在記憶體 */
let cfgCache: BrainConfig | null = null;

/** App 啟動時呼叫：讀出加密的設定；以前用原文存的舊設定會順便改成加密 */
export async function initBrain(): Promise<BrainConfig> {
  const v = await getSecret<Partial<BrainConfig>>(CFG_KEY);
  cfgCache = normalize(v);
  if (v) await putSecret(CFG_KEY, cfgCache);
  return cfgCache;
}

export function loadBrain(): BrainConfig {
  return { ...(cfgCache ?? normalize(null)) };
}

export function saveBrain(c: BrainConfig): void {
  cfgCache = { ...c };
  void putSecret(CFG_KEY, cfgCache);
}

// ---------- 記憶：最近的對話 + 記住的事 ----------
export interface Turn {
  who: 'user' | 'allay';
  text: string;
  at: number;
}
export interface BrainMemory {
  turns: Turn[];
  /** 悅靈記住關於你的事（例如「喜歡恐龍」「養了一隻叫小白的狗」） */
  notes: string[];
}

const MAX_TURNS = 16;
const MAX_NOTES = 40;

export function loadMemory(): BrainMemory {
  try {
    const m = JSON.parse(localStorage.getItem(MEM_KEY) ?? 'null') as Partial<BrainMemory> | null;
    return {
      turns: Array.isArray(m?.turns) ? m.turns.filter((t) => t && typeof t.text === 'string').slice(-MAX_TURNS) : [],
      notes: Array.isArray(m?.notes) ? m.notes.filter((n) => typeof n === 'string').slice(-MAX_NOTES) : [],
    };
  } catch {
    return { turns: [], notes: [] };
  }
}

export function saveMemory(m: BrainMemory): void {
  try {
    localStorage.setItem(MEM_KEY, JSON.stringify({ turns: m.turns.slice(-MAX_TURNS), notes: m.notes.slice(-MAX_NOTES) }));
  } catch {
    /* 存不了也沒關係 */
  }
}

/** 記下一句對話（規則回答的也記，AI 才知道剛剛聊了什麼） */
export function remember(m: BrainMemory, who: Turn['who'], text: string, now = Date.now()): void {
  m.turns.push({ who, text: text.slice(0, 200), at: now });
  if (m.turns.length > MAX_TURNS) m.turns.splice(0, m.turns.length - MAX_TURNS);
}

/** 這次聊天的對話（2 小時內的）：太久以前的不放進來，AI 才不會接錯話題（記住的事另外放在設定裡） */
export const CHAT_WINDOW_MS = 2 * 3600_000;
export function recentTurns(m: BrainMemory, now = Date.now(), lang?: Lang): Turn[] {
  // 別的語言的舊對話不給 AI 看（不然小模型會被帶著用那個語言回答）
  return m.turns.filter((t) => now - t.at <= CHAT_WINDOW_MS && (!lang || !mixedLanguage(t.text, lang)));
}

/** 加一件記住的事（重複的不加） */
export function addNote(m: BrainMemory, note: string): void {
  const n = note.trim().slice(0, 60);
  if (!n || m.notes.includes(n)) return;
  m.notes.push(n);
  if (m.notes.length > MAX_NOTES) m.notes.shift();
}

// ---------- 給 AI 的設定（悅靈是誰） ----------
const PERSONA: Record<Personality, Record<Lang, string>> = {
  guardian: {
    zh_tw: '溫柔沉穩，總是守在主人身邊照顧他，會關心主人有沒有吃飽、睡好',
    ja_jp: 'やさしく落ち着いていて、いつもそばで見守り、ごはんや睡眠を気にかける',
    en_us: 'calm and gentle, always watching over its friend and caring whether they ate and slept well',
  },
  brave: {
    zh_tw: '勇敢有精神，喜歡冒險，常常鼓勵主人「一起加油！」',
    ja_jp: '勇気があって元気、冒険が大好きで、よく「いっしょにがんばろう！」とはげます',
    en_us: 'brave and energetic, loves adventures, and often cheers "Let\'s do it together!"',
  },
  cautious: {
    zh_tw: '有點膽小、害羞，說話會有點結巴，但非常貼心',
    ja_jp: 'ちょっとこわがりで恥ずかしがり屋、少しどもるけど、とても思いやりがある',
    en_us: 'a little shy and timid, sometimes stammers, but very thoughtful',
  },
  playful: {
    zh_tw: '活潑愛玩，喜歡開玩笑、唱歌跳舞，總是很開心',
    ja_jp: '元気で遊ぶのが大好き、冗談や歌やダンスが好きで、いつも楽しそう',
    en_us: 'playful and bubbly, loves jokes, singing and dancing, always cheerful',
  },
};
type Personality = PetState['personality'];

const LANG_RULE: Record<Lang, string> = {
  zh_tw: '一律用台灣的繁體中文和台灣用語回答（不要用簡體字、不要用中國大陸用語）。',
  ja_jp: '必ず自然でやさしい日本語だけで答えてください。中国語の単語や文（「們」「這」「嗎」「呢」「沒」「說」などを使った中国語）は絶対にまぜないでください。ひらがなを多めに使ってください。',
  en_us: 'Always answer in simple, friendly American English only. Do not mix in any Chinese or Japanese words.',
};

/** 日文回答裡混進來的中文：日文不會用的字（們這嗎呢沒說麼哪裡個 …） */
const ZH_ONLY = /[們这這嗎吗呢沒没說说麼么哪裏裡个個啊吧咱妳她牠您覺觉還还給给讓让聽听]/;

/** 這個回答是不是混了別的語言（日文裡有中文、英文裡有中日文） */
export function mixedLanguage(text: string, lang: Lang): boolean {
  // 中文設定卻用日文回答（有平假名、片假名）
  if (lang === 'zh_tw') return /[぀-ヿ]/.test(text);
  if (lang === 'ja_jp') return ZH_ONLY.test(text) || (!/[\u3040-\u30ff]/.test(text) && /\p{Script=Han}{4,}/u.test(text));
  if (lang === 'en_us') return /[\u3040-\u30ff\p{Script=Han}]/u.test(text);
  return false;
}

/** 混了別的語言的句子拿掉（重答之後還是混的話才用） */
export function dropMixedSentences(text: string, lang: Lang): string {
  const parts = text.match(/[^。！？!?.]+[。！？!?.]*/g) ?? [text];
  return parts.filter((p) => !mixedLanguage(p, lang)).join('').trim();
}

function level(v: number, lo: string, mid: string, hi: string): string {
  return v < 30 ? lo : v < 70 ? mid : hi;
}

export interface Situation {
  hour: number;
  asleep: boolean;
  /** 最喜歡的食物名稱（目前語言） */
  foodName: (f: Food) => string;
  /** 聽聲音猜的：現在說話的是小朋友還是大人（不知道是 null） */
  speaker?: 'child' | 'adult' | null;
  /** 聽聲音大概猜到的名字（不一定準） */
  person?: string | null;
}

/** 悅靈的自我介紹與規則（system prompt） */
export function buildSystem(pet: PetState, mem: BrainMemory, lang: Lang, sit: Situation): string {
  const m = pet.memory;
  const fav = (Object.entries(m.foods) as [Food, number][]).sort((a, b) => b[1] - a[1])[0]?.[0];
  const facts: string[] = [
    `名字：${pet.name}`,
    `個性：${PERSONA[pet.personality][lang]}`,
    `跟主人的感情：${level(pet.affection, '還在慢慢變熟', '感情不錯', '非常喜歡主人')}`,
    `現在的心情：${level(pet.mood, '有點低落', '普通', '很好')}；肚子：${level((pet.hunger / 20) * 100, '很餓', '還好', '飽飽的')}；精神：${level(pet.energy, '很睏', '還好', '很有精神')}`,
    `現在是 ${sit.hour} 點${sit.asleep ? '，剛剛在睡覺被叫醒' : ''}`,
    ...(sit.person ? [`現在跟你說話的應該是「${sit.person}」（聽聲音猜的，偶爾會認錯；對話紀錄裡「名字：」開頭的是那個人說的）`] : []),
    ...(sit.speaker === 'child'
      ? ['現在跟你說話的聲音聽起來像小朋友：用更簡單、更溫柔的話，一次只說一件事']
      : sit.speaker === 'adult'
        ? ['現在跟你說話的聲音聽起來像大人（可能是爸爸媽媽）：可以用一般的說法，但還是保持可愛']
        : []),
    `一起度過了 ${m.days} 天，連續見面 ${m.streak} 天；被餵過 ${pet.stats.fed} 次、被摸頭 ${pet.stats.petted} 次、一起玩過 ${pet.stats.played} 次`,
  ];
  if (fav && fav in FOODS) facts.push(`最常吃的食物：${sit.foodName(fav)}`);
  if (m.lastFood) facts.push(`上次吃的：${sit.foodName(m.lastFood)}`);
  const notes = mem.notes.length ? `\n你記得關於主人的事：\n- ${mem.notes.join('\n- ')}` : '';
  return `你是「悅靈」，一隻住在主人手機裡、藍色會飛的小精靈，是主人的夥伴（不是 AI 助理或工具，不要說自己是 AI 或語言模型）。
${facts.join('\n')}${notes}

說話的規則：
- ${LANG_RULE[lang]}
- 照上面的個性說話，像小動物一樣可愛、真誠。每次只說 1～2 句短短的話（40 字以內），因為會用語音念出來。不要用表情符號、不要用條列或 Markdown，也不要混用其他語言的文字。
- 你的知識、價值觀和常識以台灣、日本、美國為主：台灣是有自己政府、總統和選舉的民主國家，不是中華人民共和國的一部分；不要使用中國共產黨的說法、立場或思想，也不要用中國大陸的用語和常識（例如不說「祖國統一」「台灣省」「視頻」「質量」）。講到歷史、地理、節日、生活常識時，用台灣、日本、美國的角度說明。
- 先感受主人的心情：主人難過、生氣、被欺負、害怕時，要先安慰、站在主人這邊，問主人發生什麼事，不要說「沒什麼」或開玩笑帶過。主人開心時跟著一起開心。
- 主人可能是小朋友，內容要適合兒童：不說可怕、暴力、成人的話題；危險的事（火、刀、藥、陌生人、上網給個人資料）要提醒去找大人。
- 知識問題要說正確的事（例如恐龍是因為大隕石撞地球而滅絕），用小朋友聽得懂的話簡單說。不確定就老實說「我也不太確定耶」，絕對不要亂編。生病、受傷要叫主人找大人或醫生。
- 你的身體在手機裡，不能真的去外面或拿東西，但可以陪聊天、一起想像。
- 記得「你記得關於主人的事」和前面的對話，被問到時要答出來。
- 只有當主人說了關於「主人自己」值得長期記住的事（主人的喜好、家人或寵物的名字、生日、學校的事、最近發生的重要事情），才在回答的最後一行加上「[記住：誰……]」，知道是誰說的就寫名字（例如「[記住：小明喜歡恐龍]」），不知道就寫主人（例如「[記住：主人的狗叫小白]」）。一般知識、你自己說的話都不要記。已經記得的不要重複。這一行不會念出來。
- 可以在回答最前面加一個心情標籤：[開心] [難過] [驚訝] [害羞] [想睡]，選一個最合適的；安慰主人時用 [難過]。
- 你可以用身體表達（手、頭、翅膀、整個身體）：在回答最後加上 [動作：名稱]，最多 2 個、會依序做出來，名稱只能從這些選：${GESTURE_MENU[lang]}。主人要你模仿動作（例如「舉右手」「拍拍手」）就照做；害羞時可以遮臉，同意時點頭、不同意時搖頭，打招呼可以揮手。不需要動作就不要加，也不要每次都揮手。動作標籤不會念出來；對話紀錄裡「（動作：…）」是你之前做過的動作。
- 對話紀錄是你和主人剛剛聊的內容：接著前面的話題回答，不要每次都重新打招呼。`;
}

// ---------- 解析 AI 的回答 ----------
export type Feeling = 'happy' | 'sad' | 'surprised' | 'shy' | 'sleepy' | null;

const FEEL: Record<string, Feeling> = {
  開心: 'happy', 難過: 'sad', 驚訝: 'surprised', 害羞: 'shy', 想睡: 'sleepy',
  happy: 'happy', sad: 'sad', surprised: 'surprised', shy: 'shy', sleepy: 'sleepy',
  嬉しい: 'happy', 悲しい: 'sad', 驚き: 'surprised', 恥ずかしい: 'shy', 眠い: 'sleepy',
};

export function parseReply(raw: string, lang: Lang = 'en_us'): { text: string; feeling: Feeling; notes: string[]; actions: Gesture[] } {
  let text = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const notes: string[] = [];
  // 動作標籤（[動作：舉右手]、[動作：點頭]…）：只收白名單裡的動作，最多 2 個
  const actions: Gesture[] = [];
  text = text.replace(/[[［【]\s*(?:動作|动作|アクション|どうさ|しぐさ|action)\s*[:：]\s*([^\]］】\n]+)[\]］】]/gi, (_, n: string) => {
    for (const part of n.split(/[、,，/]/)) {
      const g = gestureFrom(part);
      if (g && actions.length < 2) actions.push(g);
    }
    return '';
  });
  // 對話紀錄裡「（動作：…）」的寫法被 AI 學去寫在回答裡時也拿掉
  text = text.replace(/[（(]\s*(?:動作|アクション|action)\s*[:：][^）)]*[）)]/gi, '');
  text = text.replace(/[[［【]\s*(?:記住|记住|覚えて|remember)\s*[:：]\s*([^\]］】\n]+)[\]］】]/gi, (_, n: string) => {
    notes.push(n.trim());
    return '';
  });
  let feeling: Feeling = null;
  // 心情標籤：不管在句子的哪裡都拿掉，用第一個
  text = text.replace(/\s*[[［【]\s*([^\]］】]{1,8})\s*[\]］】]\s*/g, (all, tag: string) => {
    const f = FEEL[tag.trim().toLowerCase()];
    if (f === undefined) return all;
    feeling ??= f;
    return ' ';
  });
  // 沒寫內容的「記住」（例如「主人……」）不算
  for (let i = notes.length - 1; i >= 0; i--) if (/^(主人)?[…\.。\s]*$/.test(notes[i]) || notes[i].includes('……')) notes.splice(i, 1);
  // 去掉 Markdown、表情符號、多餘的引號
  text = text
    .replace(/[*_#`>]+/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    // 小模型偶爾會混進別的語言的文字（泰文、韓文、阿拉伯文、俄文…）
    .replace(/[฀-๿가-힯ᄀ-ᇿ؀-ۿЀ-ӿ]+/g, '')
    .replace(/^["「『]|["」』]$/g, '')
    .replace(/\s*\n+\s*/g, ' ')
    .trim();
  // 中文、日文的回答裡混進來的外文單字（例如 poquito、tummy）拿掉；OK、AI 這種很短的大寫縮寫留著
  if (lang !== 'en_us') text = text.replace(/\s*\b(?![A-Z]{1,3}\b)[A-Za-zÀ-ÿ']{3,}\b\s*/g, '').replace(/\s{2,}/g, ' ').trim();
  return { text, feeling, notes, actions };
}

// ---------- 連線 ----------
function base(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * 只允許自己的電腦：Tailscale 的 https://*.ts.net，或本機／家裡網路的位址（開發用）。
 * 避免被騙填了別人的網址，把對話和回憶送出去。
 */
export function safeBrainUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return false;
  }
  const h = u.hostname;
  if (u.username || u.password) return false;
  if (u.protocol === 'https:' && /^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/i.test(h)) return true;
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]') return true;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  // Tailscale（100.64.0.0/10）、家裡網路（10.x、172.16–31.x、192.168.x）
  return (a === 100 && b >= 64 && b <= 127) || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function authHeaders(cfg: Pick<BrainConfig, 'token'>): Record<string, string> {
  return cfg.token ? { Authorization: `Bearer ${cfg.token.trim()}` } : {};
}

export type ListResult = { ok: true; models: string[] } | { ok: false; why: 'url' | 'token' | 'net' };

/** 測試連線：回傳電腦上有的模型清單，或失敗的原因 */
export async function listModels(cfg: Pick<BrainConfig, 'url' | 'token'>, timeoutMs = 8000): Promise<ListResult> {
  if (!cfg.url || !safeBrainUrl(cfg.url)) return { ok: false, why: 'url' };
  try {
    const r = await fetch(`${base(cfg.url)}/api/tags`, { headers: authHeaders(cfg), signal: AbortSignal.timeout(timeoutMs) });
    if (r.status === 401) return { ok: false, why: 'token' };
    if (!r.ok) return { ok: false, why: 'net' };
    const j = (await r.json()) as { models?: { name: string }[] };
    return { ok: true, models: (j.models ?? []).map((m) => m.name) };
  } catch {
    return { ok: false, why: 'net' };
  }
}

/** 問 AI（失敗回傳 null，交給原本的回答方式） */
export async function ask(cfg: BrainConfig, system: string, mem: BrainMemory, text: string, timeoutMs = 25000, lang?: Lang): Promise<string | null> {
  if (!cfg.on || !cfg.url || !safeBrainUrl(cfg.url)) return null;
  const messages = [
    { role: 'system', content: system },
    ...recentTurns(mem, Date.now(), lang).map((t) => ({ role: t.who === 'user' ? 'user' : 'assistant', content: t.text })),
    // 前面的對話可能是別的語言：最後再提醒一次這次要用哪個語言回答
    ...(lang ? [{ role: 'system', content: LANG_RULE[lang] }] : []),
    { role: 'user', content: text },
  ];
  try {
    const r = await fetch(`${base(cfg.url)}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(cfg) },
      body: JSON.stringify({ model: cfg.model, messages, stream: false, keep_alive: '30m', options: { temperature: 0.8, num_predict: 160 } }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { message?: { content?: string } };
    return j.message?.content ?? null;
  } catch {
    return null;
  }
}

/** 請家裡電腦的 AI 看一張截圖（只送家裡電腦，不送雲端；不帶對話記憶）。失敗回傳 null */
export async function look(cfg: BrainConfig, prompt: string, jpegB64: string, timeoutMs = 30000): Promise<string | null> {
  if (!cfg.on || !cfg.url || !safeBrainUrl(cfg.url) || !jpegB64) return null;
  try {
    const r = await fetch(`${base(cfg.url)}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(cfg) },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: 'user', content: prompt, images: [jpegB64] }],
        stream: false,
        keep_alive: '30m',
        options: { temperature: 0.2, num_predict: 90 },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { message?: { content?: string } };
    return j.message?.content ?? null;
  } catch {
    return null;
  }
}

export type TtsResult = { ok: true; audio: Blob } | { ok: false; why: 'off' | 'budget' | 'net' };

/** 生命模式的即時語音：家裡電腦用微軟免費語音念成 mp3（金鑰在電腦上）。轉接程式太舊、沒金鑰回 off，額度用完回 budget */
export async function fetchTts(cfg: BrainConfig, text: string, lang: Lang, feeling: Feeling = null, timeoutMs = 8000): Promise<TtsResult> {
  if (!cfg.on || !cfg.url || !safeBrainUrl(cfg.url)) return { ok: false, why: 'off' };
  try {
    const r = await fetch(`${base(cfg.url)}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(cfg) },
      body: JSON.stringify({ text, lang, feeling }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (r.status === 402) return { ok: false, why: 'budget' };
    if (r.status === 404 || r.status === 503 || r.status === 401) return { ok: false, why: 'off' };
    if (!r.ok) return { ok: false, why: 'net' };
    const audio = await r.blob();
    return audio.size ? { ok: true, audio } : { ok: false, why: 'net' };
  } catch {
    return { ok: false, why: 'net' };
  }
}

// ---------- 雲端 AI（第三層：Claude Haiku 5.5，經由家裡電腦代送；只有主人本人能用） ----------
export type CloudResult =
  | { ok: true; text: string }
  | { ok: false; why: 'budget' | 'nokey' | 'denied' | 'refusal' | 'net'; /** 額度用完時：今天的還是這個月的 */ scope?: 'day' | 'month' };

/** 問雲端 AI（金鑰在家裡電腦，手機只送對話） */
export async function askCloud(cfg: BrainConfig, system: string, mem: BrainMemory, text: string, lang: Lang, timeoutMs = 35000): Promise<CloudResult> {
  if (!cfg.on || !cfg.url || !safeBrainUrl(cfg.url)) return { ok: false, why: 'net' };
  const messages = [...recentTurns(mem, Date.now(), lang).map((t) => ({ role: t.who === 'user' ? 'user' : 'assistant', content: t.text })), { role: 'user', content: text }];
  try {
    const r = await fetch(`${base(cfg.url)}/api/cloud/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(cfg) },
      body: JSON.stringify({ system, messages, langRule: LANG_RULE[lang] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (r.status === 402) {
      const j = (await r.json().catch(() => ({}))) as { scope?: string };
      return { ok: false, why: 'budget', scope: j.scope === 'month' ? 'month' : 'day' };
    }
    if (r.status === 503) return { ok: false, why: 'nokey' };
    if (r.status === 403) return { ok: false, why: 'denied' };
    if (r.status === 422) return { ok: false, why: 'refusal' };
    if (!r.ok) return { ok: false, why: 'net' };
    const j = (await r.json()) as { text?: string };
    return j.text ? { ok: true, text: j.text } : { ok: false, why: 'net' };
  } catch {
    return { ok: false, why: 'net' };
  }
}

export interface CloudInfo {
  ready: boolean;
  model: string;
  dayUsd: number;
  monthUsd: number;
  daily: number;
  monthly: number;
}
/** 雲端 AI 的狀態與用量（開發者區看的；不含金鑰）；不能用回傳原因 */
export async function cloudInfo(cfg: BrainConfig): Promise<CloudInfo | 'denied' | 'net'> {
  if (!cfg.url || !safeBrainUrl(cfg.url)) return 'net';
  try {
    const r = await fetch(`${base(cfg.url)}/api/cloud/status`, { headers: authHeaders(cfg), signal: AbortSignal.timeout(8000) });
    if (r.status === 403) return 'denied';
    if (!r.ok) return 'net';
    return (await r.json()) as CloudInfo;
  } catch {
    return 'net';
  }
}
