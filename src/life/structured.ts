// 大腦 → 身體的固定格式（生命模式、家裡電腦的 AI）。
// 以前 AI 在一段文字裡夾 [意圖：…]、[動作：…] 標籤，小模型常寫錯格式、把標籤念出來、或只寫標籤不說話。
// 現在請家裡電腦的 AI（Ollama）一定用這個 JSON 格式回答，欄位都只能從清單裡選（Ollama 會強制照格式）：
//   say      要說的話（可以空白）
//   intent   接下來想做的活動（清單裡的名稱，或空白＝不換）
//   mood     心情（或空白）
//   actions  身體動作（最多 2 個）
//   remember 值得長期記住的事（或空白）
//   name     有人告訴她的名字（或空白）
// 轉回標籤字串後交給原本的解析（同一套過濾：狀態數字、括號、編造的東西…），所以後面的流程不用改。
// 只用在家裡電腦的 AI；雲端 AI 照舊用標籤。
import type { Lang } from '../i18n';
import { GESTURE_MENU } from '../three/gestures';

const MOODS: Record<Lang, string[]> = {
  zh_tw: ['開心', '難過', '驚訝', '害羞', '想睡'],
  ja_jp: ['うれしい', 'かなしい', 'びっくり', 'はずかしい', 'ねむい'],
  en_us: ['happy', 'sad', 'surprised', 'shy', 'sleepy'],
};
const TAG: Record<Lang, { intent: string; action: string; remember: string; name: string }> = {
  zh_tw: { intent: '意圖', action: '動作', remember: '記住', name: '名字' },
  ja_jp: { intent: '意図', action: '動作', remember: '覚えて', name: '名前' },
  en_us: { intent: 'intent', action: 'action', remember: 'remember', name: 'name' },
};

export interface LifeJson {
  say?: string;
  intent?: string;
  mood?: string;
  actions?: string[];
  remember?: string;
  name?: string;
}

/** Ollama 的 format（JSON Schema）：意圖、心情、動作只能從清單選；空字串＝沒有 */
export function replySchema(lang: Lang, intents: string[]): Record<string, unknown> {
  const gestures = GESTURE_MENU[lang].split(lang === 'en_us' ? ', ' : '、');
  return {
    type: 'object',
    properties: {
      say: { type: 'string' },
      intent: { type: 'string', enum: ['', ...intents] },
      mood: { type: 'string', enum: ['', ...MOODS[lang]] },
      actions: { type: 'array', items: { type: 'string', enum: gestures }, maxItems: 2 },
      remember: { type: 'string' },
      name: { type: 'string' },
    },
    required: ['say', 'intent', 'mood', 'actions'],
  };
}

/** 告訴 AI 用這個格式回答（接在系統說明最後） */
export const FORMAT_HINT: Record<Lang, string> = {
  zh_tw:
    '回答格式：只輸出 JSON。say＝要說的話（不說話就空字串）；intent＝想做的活動（清單裡的名稱，不換就空字串）；mood＝心情（或空字串）；actions＝身體動作（最多 2 個，或空陣列）；remember＝值得長期記住的事（或空字串）；name＝有人告訴你的名字（或空字串）。標籤不用再寫在 say 裡。',
  ja_jp:
    '答えのかたち：JSON だけを出す。say＝話すことば（話さないときは空文字）、intent＝したい活動（リストの名前。変えないなら空文字）、mood＝気分（または空文字）、actions＝体のうごき（2つまで、なければ空の配列）、remember＝長くおぼえておきたいこと（または空文字）、name＝だれかが教えてくれた名前（または空文字）。say の中にタグは書かない。',
  en_us:
    'Answer format: output JSON only. say = what you say (empty string if silent); intent = the activity you want to do (a name from the list, or empty string to keep going); mood = your mood (or empty string); actions = body movements (up to 2, or empty array); remember = something worth remembering long-term (or empty string); name = a name someone told you (or empty string). Don\'t put tags inside say.',
};

/** JSON 回答 → 原本的標籤字串（交給 parseLifeReply）；不是 JSON 就原樣回傳 */
export function jsonToTags(raw: string, lang: Lang): string {
  let j: LifeJson;
  try {
    j = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')) as LifeJson;
  } catch {
    return raw;
  }
  if (!j || typeof j !== 'object') return raw;
  const t = TAG[lang];
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const parts: string[] = [];
  if (s(j.mood)) parts.push(`[${s(j.mood)}]`);
  if (s(j.say)) parts.push(s(j.say));
  if (s(j.intent)) parts.push(`[${t.intent}：${s(j.intent)}]`);
  const acts = Array.isArray(j.actions) ? j.actions.map(s).filter(Boolean).slice(0, 2) : [];
  if (acts.length) parts.push(`[${t.action}：${acts.join('、')}]`);
  if (s(j.remember)) parts.push(`[${t.remember}：${s(j.remember)}]`);
  if (s(j.name)) parts.push(`[${t.name}：${s(j.name)}]`);
  return parts.join(' ');
}
