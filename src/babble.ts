// 悅靈語：像《動物森友會》那樣，把一句話念成快快的、聽不懂但很像在講話的聲音。
// 每個音節 = 子音（很短的氣音、爆破音或鼻音）+ 母音（用嘴形共振做出 a/i/u/e/o 的音色），
// 再加上語調：整句慢慢往下、中文字帶一點聲調、問句結尾往上揚。
// 全部用 Web Audio 即時合成（原創），不用任何錄音或原版音效。

export type Vowel = 'a' | 'i' | 'u' | 'e' | 'o' | 'n';
/** 子音的種類：無、氣音（s/sh）、爆破音（t/k/p）、h、鼻音（m/n）、流音（r/y/w） */
export type Cons = '' | 's' | 't' | 'k' | 'p' | 'h' | 'm' | 'n' | 'r';
/** 聲調（中文字用）：平、升、降、先降後升 */
export type Tone = 0 | 1 | 2 | 3;

export interface Syllable {
  c: Cons;
  v: Vowel;
  tone: Tone;
}
/** null = 停頓（標點） */
export type Unit = Syllable | null;

// ---------- 日文假名：照真正的讀音 ----------
const KANA_ROWS: [string, Cons][] = [
  ['あいうえお', ''],
  ['かきくけこ', 'k'],
  ['がぎぐげご', 'k'],
  ['さしすせそ', 's'],
  ['ざじずぜぞ', 's'],
  ['たちつてと', 't'],
  ['だぢづでど', 't'],
  ['なにぬねの', 'n'],
  ['はひふへほ', 'h'],
  ['ばびぶべぼ', 'p'],
  ['ぱぴぷぺぽ', 'p'],
  ['まみむめも', 'm'],
  ['らりるれろ', 'r'],
];
const VOWELS: Vowel[] = ['a', 'i', 'u', 'e', 'o'];
const KANA = new Map<string, Syllable>();
for (const [row, c] of KANA_ROWS) [...row].forEach((k, i) => KANA.set(k, { c, v: VOWELS[i], tone: 0 }));
for (const [k, v] of [['や', 'a'], ['ゆ', 'u'], ['よ', 'o'], ['わ', 'a'], ['を', 'o']] as [string, Vowel][]) KANA.set(k, { c: 'r', v, tone: 0 });
KANA.set('ん', { c: 'n', v: 'n', tone: 0 });

function kana(ch: string): Syllable | null | undefined {
  // 片假名 → 平假名
  const h = /[ァ-ヶ]/.test(ch) ? String.fromCharCode(ch.charCodeAt(0) - 0x60) : ch;
  // 小字（ゃゅょっー）不算一個音節
  if (/[ぁぃぅぇぉゃゅょっゎー]/.test(h)) return undefined;
  return KANA.get(h) ?? null;
}

// ---------- 英文：每個母音群一個音節，子音看母音前面的字母 ----------
function consOf(letter: string): Cons {
  if (!letter) return '';
  if ('szcxjf'.includes(letter)) return 's';
  if ('td'.includes(letter)) return 't';
  if ('kgq'.includes(letter)) return 'k';
  if ('pbv'.includes(letter)) return 'p';
  if (letter === 'h') return 'h';
  if (letter === 'm') return 'm';
  if (letter === 'n') return 'n';
  return 'r';
}
function vowelOf(letter: string): Vowel {
  return letter === 'y' ? 'i' : (letter as Vowel);
}

function english(word: string): Syllable[] {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  const out: Syllable[] = [];
  const re = /([^aeiouy]*)([aeiouy]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(w))) out.push({ c: consOf(m[1].slice(-1)), v: vowelOf(m[2][0]), tone: 0 });
  if (!out.length && w) out.push({ c: consOf(w[0]), v: 'u', tone: 0 });
  return out;
}

// ---------- 中文字：沒有讀音資料，用字決定一個固定的音節和聲調（同一個字每次都一樣） ----------
const HAN_CONS: Cons[] = ['', 's', 't', 'k', 'p', 'h', 'm', 'n', 'r', 's', 't', ''];
function han(code: number): Syllable {
  return { c: HAN_CONS[code % HAN_CONS.length], v: VOWELS[(code >> 3) % 5], tone: ((code >> 6) % 4) as Tone };
}

/** 一句話 → 一個個音節（標點是停頓） */
export function syllables(text: string): Unit[] {
  const out: Unit[] = [];
  for (const tok of text.match(/[A-Za-z']+|[^\sA-Za-z']/g) ?? []) {
    if (/^[A-Za-z']+$/.test(tok)) out.push(...english(tok));
    else if (/[，。！？、,.!?…～~；;：:「」『』（）()]/.test(tok)) {
      if (out.length && out[out.length - 1] !== null) out.push(null);
    } else if (/[぀-ヿ]/.test(tok)) {
      const s = kana(tok);
      if (s) out.push(s);
    } else if (/\p{Script=Han}/u.test(tok)) out.push(han(tok.codePointAt(0) ?? 0));
    else if (/\d/.test(tok)) out.push(han(tok.charCodeAt(0) * 31));
  }
  while (out.length && out[out.length - 1] === null) out.pop();
  return out;
}

// ---------- 發聲 ----------
/** 母音的共振（小精靈的嘴比較小，整體調高一點） */
const FORMANTS: Record<Vowel, [number, number, number]> = {
  a: [850, 1220, 2810],
  i: [300, 2300, 3000],
  u: [350, 1250, 2400],
  e: [500, 1900, 2600],
  o: [500, 900, 2500],
  n: [280, 1000, 2400],
};
const SCALE = 1.28;

let noiseBuf: AudioBuffer | null = null;
function noise(ctx: BaseAudioContext): AudioBuffer {
  if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate / 4, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

export interface BabbleOpts {
  /** 基本音高（Hz） */
  f0: number;
  /** 音量 */
  level: number;
  /** 每個音節的長度（秒） */
  step?: number;
}

/** 把一句話念成悅靈語，接到 out；回傳大約要念多久（秒） */
export function speakBabble(ctx: BaseAudioContext, out: AudioNode, text: string, o: BabbleOpts, start = ctx.currentTime + 0.03): number {
  const units = syllables(text).slice(0, 60);
  const n = units.filter(Boolean).length;
  if (!n) return 0;
  const step = o.step ?? (n > 30 ? 0.062 : 0.075);
  const question = /[?？]\s*$/.test(text);
  let t = start;
  let i = 0;
  for (const u of units) {
    if (!u) {
      t += 0.13;
      continue;
    }
    const last = i >= n - 2;
    // 語調：整句慢慢往下；每個音節有一點起伏；問句最後往上；最後一個音節拉長一點
    const decl = 1 - 0.14 * (i / Math.max(1, n - 1));
    const accent = 2 ** (((Math.random() - 0.5) * 2.5) / 12);
    const rise = question && last ? 2 ** ((4 + (i - (n - 2)) * 3) / 12) : 1;
    const f = o.f0 * decl * accent * rise;
    const dur = step * (last ? 1.35 : 0.9 + Math.random() * 0.2);
    voice(ctx, out, u, f, t, dur, o.level);
    t += dur;
    i++;
  }
  return t - start;
}

/** 一個音節：子音（氣音、爆破、鼻音）＋母音（鋸齒波經過三個共振） */
function voice(ctx: BaseAudioContext, out: AudioNode, s: Syllable, f: number, t: number, dur: number, level: number): void {
  // 子音
  const consDur = s.c === 's' ? 0.035 : s.c === 'h' ? 0.025 : s.c === 't' || s.c === 'k' || s.c === 'p' ? 0.014 : 0;
  if (consDur) {
    const src = ctx.createBufferSource();
    src.buffer = noise(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = s.c === 's' ? 'highpass' : 'bandpass';
    bp.frequency.value = { s: 4500, t: 3500, k: 2200, p: 900, h: 1600 }[s.c as 's' | 't' | 'k' | 'p' | 'h'];
    bp.Q.value = 1;
    const g = ctx.createGain();
    const lv = level * (s.c === 's' ? 0.35 : s.c === 'h' ? 0.2 : 0.5);
    g.gain.setValueAtTime(lv, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + consDur);
    src.connect(bp).connect(g).connect(out);
    src.start(t, Math.random() * 0.1);
    src.stop(t + consDur + 0.01);
  }
  const vt = t + consDur * 0.7;
  const vdur = Math.max(0.03, dur - consDur * 0.7);
  // 聲帶：鋸齒波，帶一點顫動；中文字的聲調
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  const tone = s.tone;
  const [a, b] = tone === 1 ? [0.9, 1.12] : tone === 2 ? [1.12, 0.88] : tone === 3 ? [0.95, 1.05] : [1, 1];
  osc.frequency.setValueAtTime(f * a, vt);
  if (tone === 3) osc.frequency.linearRampToValueAtTime(f * 0.88, vt + vdur * 0.5);
  osc.frequency.linearRampToValueAtTime(f * b, vt + vdur);
  // 嘴形：三個共振；鼻音（m/n）開頭先悶悶的
  const mix = ctx.createGain();
  mix.gain.value = 0;
  const [f1, f2, f3] = FORMANTS[s.v].map((x) => x * SCALE);
  const nasal = s.c === 'm' || s.c === 'n' || s.v === 'n';
  [
    [f1, 6, 1],
    [f2, 9, 0.55],
    [f3, 10, 0.25],
  ].forEach(([fr, q, gv]) => {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(nasal ? fr * 0.6 : s.c === 'r' ? fr * 0.8 : fr, vt);
    bp.frequency.linearRampToValueAtTime(fr, vt + Math.min(0.03, vdur * 0.4));
    bp.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = gv;
    osc.connect(bp).connect(g).connect(mix);
  });
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, vt);
  env.gain.exponentialRampToValueAtTime(level * 2.2, vt + 0.012);
  env.gain.setValueAtTime(level * 2.2, vt + vdur * 0.6);
  env.gain.exponentialRampToValueAtTime(0.0001, vt + vdur);
  mix.gain.value = 1;
  mix.connect(env).connect(out);
  osc.start(vt);
  osc.stop(vt + vdur + 0.02);
}
