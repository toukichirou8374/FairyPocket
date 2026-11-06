// 開發者區的門：要輸入密碼才能進去（AI 大腦的網址、通行碼等技術設定都在裡面）。
// 密碼第一次進入時在這台裝置自己設定，只存「算不回原文的檢查值」（PBKDF2），不放進備份、不上傳。
// 忘記密碼：回答三個問題，全部答對就能重新設定。答案不寫在程式裡（程式是公開的），只放三個答案合起來的檢查值。
// 注意：這是防止小朋友或借玩的人亂改設定用的，不是銀行等級的保護。

import { t } from '../i18n';

const PASS_KEY = 'fairypocket.devpass.v1';
const RECOVERY_SALT = 'fairypocket-dev-recovery-v1';
/** 三個答案（正規化後用「|」接起來）的 PBKDF2-SHA256 檢查值 */
const RECOVERY_HASH = '36f688644718c7c3206d5fdc09c5da56c7b7096c33b4dff0a6b59e66c3f0ae3c';
const ITER = 150_000;
/** 解鎖後 10 分鐘內再進來不用重打密碼 */
const UNLOCK_MS = 10 * 60_000;
let unlockedAt = -Infinity;

/** 比對前先整理：全形半形統一、大小寫、空白、片假名轉平假名（例如 アイウ = あいう） */
export function normalizeAnswer(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[\u30a1-\u30f6]/g, (x) => String.fromCharCode(x.charCodeAt(0) - 0x60));
}

async function pbkdf2(text: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(text), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: ITER }, key, 256);
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function recoveryOk(answers: [string, string, string]): Promise<boolean> {
  return (await pbkdf2(answers.map(normalizeAnswer).join('|'), RECOVERY_SALT)) === RECOVERY_HASH;
}

interface Saved {
  salt: string;
  hash: string;
}
function loadPass(): Saved | null {
  try {
    const v = JSON.parse(localStorage.getItem(PASS_KEY) ?? 'null') as Saved | null;
    return v && typeof v.salt === 'string' && typeof v.hash === 'string' ? v : null;
  } catch {
    return null;
  }
}
async function setPass(pass: string): Promise<void> {
  const salt = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
  localStorage.setItem(PASS_KEY, JSON.stringify({ salt, hash: await pbkdf2(pass, salt) }));
}
async function passOk(pass: string): Promise<boolean> {
  const s = loadPass();
  return !!s && (await pbkdf2(pass, s.salt)) === s.hash;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  parent?.appendChild(e);
  return e;
}

const LOCK_KEY = 'fairypocket.devlock.v1';
function loadLock(): { tries: number; until: number } {
  try {
    const v = JSON.parse(localStorage.getItem(LOCK_KEY) ?? 'null') as { tries: number; until: number } | null;
    return v && typeof v.tries === 'number' ? v : { tries: 0, until: 0 };
  } catch {
    return { tries: 0, until: 0 };
  }
}
function saveLock(v: { tries: number; until: number }): void {
  try {
    localStorage.setItem(LOCK_KEY, JSON.stringify(v));
  } catch {
    /* 存不了也沒關係 */
  }
}

/** 打開開發者區：先過密碼這關，過了才呼叫 open() */
export function devGate(root: HTMLElement, open: () => void): void {
  if (performance.now() - unlockedAt < UNLOCK_MS) return open();
  const back = el('div', 'modal-back', root);
  const box = el('div', 'modal', back);
  el('h2', '', box).textContent = t('dg.title');
  const close = () => back.remove();
  const done = () => {
    unlockedAt = performance.now();
    close();
    open();
  };
  const msg = el('div', 'info', box);
  const field = (ph: string, type = 'password') => {
    const i = el('input', 'name-input', box);
    i.type = type;
    i.placeholder = ph;
    i.autocomplete = 'off';
    i.spellcheck = false;
    return i;
  };
  const row = () => el('div', 'btnrow', box);
  const btn = (parent: HTMLElement, text: string, fn: () => void) => {
    const b = el('button', 'btn', parent);
    b.textContent = text;
    b.addEventListener('click', fn);
    return b;
  };

  const setNew = (first: boolean) => {
    box.querySelectorAll(':scope > :not(h2)').forEach((x) => x !== msg && x.remove());
    msg.textContent = t(first ? 'dg.first' : 'dg.reset');
    const a = field(t('dg.newPass'));
    const b = field(t('dg.again'));
    const r = row();
    btn(r, t('dg.save'), async () => {
      if (a.value.length < 4) return void (msg.textContent = t('dg.short'));
      if (a.value !== b.value) return void (msg.textContent = t('dg.mismatch'));
      await setPass(a.value);
      done();
    });
    btn(r, t('close'), close);
  };

  const recover = () => {
    box.querySelectorAll(':scope > :not(h2)').forEach((x) => x !== msg && x.remove());
    msg.textContent = t('dg.recoverHelp');
    const qs = (['dg.q1', 'dg.q2', 'dg.q3'] as const).map((k) => {
      el('label', '', box).textContent = t(k);
      return field('', 'text');
    });
    const r = row();
    btn(r, t('dg.check'), async () => {
      msg.textContent = t('dg.checking');
      if (await recoveryOk([qs[0].value, qs[1].value, qs[2].value])) setNew(false);
      else msg.textContent = t('dg.wrongAnswers');
    });
    btn(r, t('close'), close);
  };

  if (!loadPass()) return setNew(true);
  msg.textContent = t('dg.enter');
  const p = field(t('dg.pass'));
  const r = row();
  const openBtn = btn(r, t('dg.open'), async () => {
    const lock = loadLock();
    if (Date.now() < lock.until) return void (msg.textContent = t('dg.locked', { s: Math.ceil((lock.until - Date.now()) / 1000) }));
    if (await passOk(p.value)) {
      saveLock({ tries: 0, until: 0 });
      return done();
    }
    lock.tries++;
    p.value = '';
    msg.textContent = t('dg.wrong');
    // 連續打錯 5 次以上：要等一下才能再試，而且越錯等越久（30 秒、1 分、2 分…最多 30 分鐘）
    if (lock.tries >= 5) {
      lock.until = Date.now() + Math.min(30 * 60_000, 30_000 * 2 ** Math.floor((lock.tries - 5) / 5));
      msg.textContent = t('dg.locked', { s: Math.ceil((lock.until - Date.now()) / 1000) });
    }
    saveLock(lock);
  });
  void openBtn;
  btn(r, t('dg.forgot'), recover);
  btn(r, t('close'), close);
  p.addEventListener('keydown', (e) => e.key === 'Enter' && (r.querySelector('button') as HTMLButtonElement).click());
}
