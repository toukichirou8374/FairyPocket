// 要做成聲音檔的文字清單（微軟 make-voices.mjs 和 Google make-voices-google.mjs 共用）：
// 每張貼紙的示範念法 + 悅靈固定的台詞（有名字 {n} 的句子不做，交給裝置語音）。

import { createServer } from 'vite';

export const LANGS = ['zh_tw', 'ja_jp', 'en_us'];

/** @returns {Promise<{ jobs: Map<string, { lang: string, text: string, kind: string }>, letterOf: Record<string, string> }>} */
export async function loadVoiceJobs() {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  const sb = await server.ssrLoadModule('/src/game/sbItems.ts');
  const talk = await server.ssrLoadModule('/src/game/talk.ts');
  const kg = await server.ssrLoadModule('/src/game/keyGame.ts');
  const assist = await server.ssrLoadModule('/src/assist/assistant.ts');
  await server.close();
  // 英文字母：念法文字（ay、eff…）→ 字母本身
  const letterOf = Object.fromEntries(Object.entries(kg.LETTER_SAY).map(([L, said]) => [said, L]));
  const jobs = new Map();
  const add = (lang, text, kind) => jobs.set(`${lang}|${text}`, { lang, text, kind });
  for (const it of sb.stickerBookItems()) for (const lang of LANGS) {
    const d = sb.demoSpeech(it, lang);
    add(d.lang, d.text, 'demo');
  }
  for (const [lang, t] of talk.allTalkLines()) add(lang, t, 'talk');
  for (const [lang, t] of assist.assistFixedLines()) add(lang, t, 'assist');
  return { jobs, letterOf };
}
