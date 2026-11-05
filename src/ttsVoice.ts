// 說話的聲音（裝置內建的語音合成）：悅靈說話、示範念法都用這裡選的聲音。
// iPhone 可以在「設定 → 輔助使用 → 朗讀內容 → 聲音」下載音質比較好的版本（優化／高品質，日文是「拡張／プレミア」），
// 這裡會自動優先用音質最好的；也可以在設定頁自己選（每種語言分開存在這台裝置）。

import type { Lang } from './i18n';

export interface VoiceInfo {
  name: string;
  lang: string;
  voiceURI: string;
}

export const TTS_VOICE_KEY = 'fairypocket.ttsvoice.v1';

/** 搞笑用的特殊聲音（Apple 的 Bad News、Bubbles、爺爺奶奶等），自動選的時候不要用 */
const NOVELTY = /eloquence|speech\.synthesis\.voice|\b(?:bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|albert|fred|junior|kathy|ralph|grandma|grandpa|rocko|sandy|shelley|reed|flo|eddy)\b/i;

/** 音質：3 高品質（Premium）、2 優化（Enhanced）、1 一般、0 特殊聲音 */
export function voiceQuality(v: VoiceInfo): number {
  const id = `${v.voiceURI} ${v.name}`;
  if (/premium|プレミア|高品質|高音質|優質|高級/i.test(id)) return 3;
  if (/enhanced|拡張|強化|增強|增强|優化|优化/i.test(id)) return 2;
  if (NOVELTY.test(id)) return 0;
  return 1;
}

const norm = (s: string) => s.replace('_', '-').toLowerCase();

/** 這個語言（例如 zh-TW）可以用的聲音，音質好的排前面 */
export function voicesFor(list: readonly VoiceInfo[], langTag: string): VoiceInfo[] {
  const want = norm(langTag);
  return list
    .filter((v) => norm(v.lang) === want)
    .sort((a, b) => voiceQuality(b) - voiceQuality(a) || a.name.localeCompare(b.name));
}

/** 要用哪個聲音：自己選過的優先，沒有就用音質最好的 */
export function pickVoice<V extends VoiceInfo>(list: readonly V[], langTag: string, saved?: string): V | undefined {
  const cands = voicesFor(list, langTag) as V[];
  return cands.find((v) => v.voiceURI === saved) ?? cands[0];
}

/** 設定頁顯示的名字：音質好的加星星 */
export function voiceLabel(v: VoiceInfo): string {
  const q = voiceQuality(v);
  const name = v.name.replace(/\s*\((premium|enhanced)\)|（(高品質|優化|增強|プレミア|拡張)）/gi, '').trim();
  return q === 3 ? `${name} ★★` : q === 2 ? `${name} ★` : name;
}

export function loadTtsVoices(storage: Pick<Storage, 'getItem'> = localStorage): Partial<Record<Lang, string>> {
  try {
    const v = JSON.parse(storage.getItem(TTS_VOICE_KEY) ?? '{}') as unknown;
    return v && typeof v === 'object' ? (v as Partial<Record<Lang, string>>) : {};
  } catch {
    return {};
  }
}

export function saveTtsVoice(lang: Lang, uri: string, storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): void {
  const all = loadTtsVoices(storage);
  if (uri) all[lang] = uri;
  else delete all[lang];
  storage.setItem(TTS_VOICE_KEY, JSON.stringify(all));
}
