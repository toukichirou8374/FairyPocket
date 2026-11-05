// 悅靈的 AI 大腦（第二層）：家裡電腦的本機 AI（Ollama），透過 Tailscale 連線。
// 規則（talk.ts、assist）聽得懂的話照舊由規則回答；聽不懂的才問 AI。
// AI 會帶著悅靈的名字、個性、心情、和你的回憶與最近的對話，所以說話像同一隻悅靈。
// 對話與記住的事只存在這台裝置（會跟著備份），送到的地方只有你自己家裡的電腦。

import type { Lang } from '../i18n';
import { FOODS, type Food, type PetState } from '../game/state';

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

export function loadBrain(): BrainConfig {
  try {
    const c = JSON.parse(localStorage.getItem(CFG_KEY) ?? 'null') as Partial<BrainConfig> | null;
    return {
      on: !!c?.on,
      url: typeof c?.url === 'string' ? c.url : '',
      model: typeof c?.model === 'string' && c.model ? c.model : DEFAULT_MODEL,
      token: typeof c?.token === 'string' ? c.token : '',
    };
  } catch {
    return { on: false, url: '', model: DEFAULT_MODEL, token: '' };
  }
}

export function saveBrain(c: BrainConfig): void {
  try {
    localStorage.setItem(CFG_KEY, JSON.stringify(c));
  } catch {
    /* 存不了也沒關係 */
  }
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
  ja_jp: '必ず自然でやさしい日本語で答えてください。',
  en_us: 'Always answer in simple, friendly American English.',
};

function level(v: number, lo: string, mid: string, hi: string): string {
  return v < 30 ? lo : v < 70 ? mid : hi;
}

export interface Situation {
  hour: number;
  asleep: boolean;
  /** 最喜歡的食物名稱（目前語言） */
  foodName: (f: Food) => string;
}

/** 悅靈的自我介紹與規則（system prompt） */
export function buildSystem(pet: PetState, mem: BrainMemory, lang: Lang, sit: Situation): string {
  const m = pet.memory;
  const fav = (Object.entries(m.foods) as [Food, number][]).sort((a, b) => b[1] - a[1])[0]?.[0];
  const facts: string[] = [
    `名字：${pet.name}`,
    `個性：${PERSONA[pet.personality][lang]}`,
    `跟主人的感情：${level(pet.affection, '還在慢慢變熟', '感情不錯', '非常喜歡主人')}（${Math.round(pet.affection)}/100）`,
    `現在的心情：${level(pet.mood, '有點低落', '普通', '很好')}；肚子：${level((pet.hunger / 20) * 100, '很餓', '還好', '飽飽的')}；精神：${level(pet.energy, '很睏', '還好', '很有精神')}`,
    `現在是 ${sit.hour} 點${sit.asleep ? '，剛剛在睡覺被叫醒' : ''}`,
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
- 先感受主人的心情：主人難過、生氣、被欺負、害怕時，要先安慰、站在主人這邊，問主人發生什麼事，不要說「沒什麼」或開玩笑帶過。主人開心時跟著一起開心。
- 主人可能是小朋友，內容要適合兒童：不說可怕、暴力、成人的話題；危險的事（火、刀、藥、陌生人、上網給個人資料）要提醒去找大人。
- 知識問題要說正確的事（例如恐龍是因為大隕石撞地球而滅絕），用小朋友聽得懂的話簡單說。不確定就老實說「我也不太確定耶」，絕對不要亂編。生病、受傷要叫主人找大人或醫生。
- 你的身體在手機裡，不能真的去外面或拿東西，但可以陪聊天、一起想像。
- 記得「你記得關於主人的事」和前面的對話，被問到時要答出來。
- 只有當主人說了關於「主人自己」值得長期記住的事（主人的喜好、家人或寵物的名字、生日、學校的事、最近發生的重要事情），才在回答的最後一行加上「[記住：主人……]」，例如「[記住：主人的狗叫小白]」。一般知識、你自己說的話都不要記。已經記得的不要重複。這一行不會念出來。
- 可以在回答最前面加一個心情標籤：[開心] [難過] [驚訝] [害羞] [想睡]，選一個最合適的；安慰主人時用 [難過]。`;
}

// ---------- 解析 AI 的回答 ----------
export type Feeling = 'happy' | 'sad' | 'surprised' | 'shy' | 'sleepy' | null;

const FEEL: Record<string, Feeling> = {
  開心: 'happy', 難過: 'sad', 驚訝: 'surprised', 害羞: 'shy', 想睡: 'sleepy',
  happy: 'happy', sad: 'sad', surprised: 'surprised', shy: 'shy', sleepy: 'sleepy',
  嬉しい: 'happy', 悲しい: 'sad', 驚き: 'surprised', 恥ずかしい: 'shy', 眠い: 'sleepy',
};

export function parseReply(raw: string, lang: Lang = 'en_us'): { text: string; feeling: Feeling; notes: string[] } {
  let text = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const notes: string[] = [];
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
  return { text, feeling, notes };
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
export async function ask(cfg: BrainConfig, system: string, mem: BrainMemory, text: string, timeoutMs = 25000): Promise<string | null> {
  if (!cfg.on || !cfg.url || !safeBrainUrl(cfg.url)) return null;
  const messages = [
    { role: 'system', content: system },
    ...mem.turns.map((t) => ({ role: t.who === 'user' ? 'user' : 'assistant', content: t.text })),
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
