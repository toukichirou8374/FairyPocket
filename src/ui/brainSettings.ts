// 設定頁：AI 大腦（家裡電腦的本機 AI）的開關、連線網址、模型、記憶。

import { t } from '../i18n';
import { brainState, claudeInfo, cloudInfo, listModels, loadBrain, loadMemory, saveBrain, saveMemory } from '../brain/brain';
import { AI_MODES, CLAUDE_DEPTHS, aiDiag, loadRoute, saveRoute } from '../brain/router';
import { hearInfo, hearTrace } from '../life/hearing';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  parent?.appendChild(e);
  return e;
}

export function brainSettings(box: HTMLElement): void {
  const cfg = loadBrain();
  el('label', '', box).textContent = t('ai.title');
  el('div', 'info', box).textContent = t('ai.help');
  // 設定的讀取狀態（2026-11-11：手機偶爾暫時讀不到加密的設定，看起來像被初始化）
  const state = el('div', 'info warn', box);

  const row = el('div', 'btnrow', box);
  const onBtn = el('button', 'btn', row);
  const showOn = () => {
    onBtn.textContent = `${t('ai.use')}：${t(cfg.on ? 'on' : 'off')}`;
    onBtn.classList.toggle('on', cfg.on);
  };
  showOn();
  onBtn.addEventListener('click', () => {
    cfg.on = !cfg.on;
    saveBrain(cfg);
    showOn();
  });

  // 網址＋通行碼做成 iPhone 認得的「帳號／密碼」表單：第一次連線成功時 iPhone 會問要不要存進「密碼」（iCloud 鑰匙圈），
  // 之後設定不見了，點一下欄位、用 Face ID 就能填回去（Apple 加密保管，不經過 App）
  const form = el('form', '', box);
  form.autocomplete = 'on';
  el('div', 'info', form).textContent = t('ai.url');
  const url = el('input', 'name-input', form);
  url.type = 'text';
  url.inputMode = 'url';
  url.name = 'username';
  url.placeholder = 'https://desktop-xxxx.tailxxxx.ts.net';
  url.value = cfg.url;
  url.autocomplete = 'username';
  url.autocapitalize = 'off';
  url.spellcheck = false;
  url.addEventListener('change', () => {
    cfg.url = url.value.trim();
    saveBrain(cfg);
  });

  el('div', 'info', form).textContent = t('ai.token');
  const token = el('input', 'name-input', form);
  token.type = 'password';
  token.name = 'password';
  // 存好的通行碼不再顯示（只顯示「已設定」）；要換的時候直接輸入新的（或用 iPhone 的密碼自動填入）
  token.placeholder = cfg.token ? t('ai.tokenSet') : 'xxxx-xxxx-xxxx-xxxx';
  token.value = '';
  token.autocomplete = 'current-password';
  token.spellcheck = false;
  el('div', 'info', form).textContent = t('ai.keychain');
  // 讀取中／暫時讀不到：先鎖住，不讓空白設定蓋掉原本存好的；讀好了就把值填回來
  const inputs = () => [url, token, onBtn] as (HTMLInputElement | HTMLButtonElement)[];
  const showState = () => {
    const s = brainState();
    state.textContent = s === 'loading' || s === 'locked' ? t('ai.locked') : s === 'lost' ? t('ai.lost') : '';
    state.hidden = !state.textContent;
    for (const i of inputs()) i.disabled = s === 'loading' || s === 'locked';
  };
  showState();
  if (brainState() === 'loading' || brainState() === 'locked') {
    const wait = window.setInterval(() => {
      if (!box.isConnected) return window.clearInterval(wait);
      if (brainState() === 'loading' || brainState() === 'locked') return;
      window.clearInterval(wait);
      Object.assign(cfg, loadBrain());
      url.value = cfg.url;
      token.placeholder = cfg.token ? t('ai.tokenSet') : 'xxxx-xxxx-xxxx-xxxx';
      showOn();
      showState();
    }, 1000);
  }

  el('div', 'info', box).textContent = t('ai.model');
  const model = el('select', 'name-input', box);
  const fillModels = (names: string[]) => {
    model.replaceChildren();
    for (const n of names.length ? names : [cfg.model]) {
      const o = el('option', '', model);
      o.value = o.textContent = n;
      o.selected = n === cfg.model;
    }
  };
  fillModels([]);
  model.addEventListener('change', () => {
    cfg.model = model.value;
    saveBrain(cfg);
  });

  const status = el('div', 'info', box);
  // 連線測試＝送出表單（iPhone 在這時候問要不要存密碼）
  const test = el('button', 'btn', form);
  test.type = 'submit';
  test.textContent = t('ai.test');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (brainState() === 'loading' || brainState() === 'locked') return showState();
    cfg.url = url.value.trim();
    const typed = token.value.trim();
    if (typed) cfg.token = typed;
    saveBrain(cfg);
    showState();
    status.textContent = t('ai.testing');
    const res = await listModels(cfg);
    if (!res.ok) {
      status.textContent = t(res.why === 'url' ? 'ai.badUrl' : res.why === 'token' ? 'ai.badToken' : 'ai.fail');
      return;
    }
    // 連線成功：輸入的通行碼留一下（讓 iPhone 有機會存進密碼），再清掉、只顯示「已設定」
    if (typed)
      window.setTimeout(() => {
        token.value = '';
        token.placeholder = t('ai.tokenSet');
      }, 2000);
    const names = res.models;
    if (names.length && !names.includes(cfg.model)) {
      cfg.model = names[0];
      saveBrain(cfg);
    }
    fillModels(names);
    status.textContent = t('ai.ok', { n: names.length });
  });

  // 雲端 AI（第三層）：狀態與今天、這個月的花費
  el('label', '', box).textContent = t('cloud.title');
  el('div', 'info', box).textContent = t('cloud.help');
  const cinfo = el('div', 'info', box);
  const cbtn = el('button', 'btn', box);
  cbtn.textContent = t('cloud.check');
  cbtn.addEventListener('click', async () => {
    cinfo.textContent = t('ai.testing');
    const r = await cloudInfo(cfg);
    if (r === 'denied') cinfo.textContent = t('cloud.denied');
    else if (r === 'net') cinfo.textContent = t('ai.fail');
    else if (!r.ready) cinfo.textContent = t('cloud.nokey');
    else
      cinfo.textContent = t('cloud.usage', {
        model: r.model,
        d: Math.round(r.dayUsd * 150),
        dmax: Math.round(r.daily * 150),
        m: Math.round(r.monthUsd * 150),
        mmax: Math.round(r.monthly * 150),
      });
  });

  // AI 3.0：AI 運作方式（三個來源，每次只選一個）與 Claude 深度
  el('label', '', box).textContent = t('route.title');
  el('div', 'info', box).textContent = t('route.help');
  const rs = loadRoute();
  const pick = <T extends string>(label: string, values: readonly T[], get: () => T, set: (v: T) => void, note?: (v: T) => string) => {
    el('div', 'info', box).textContent = label;
    const sel = el('select', 'name-input', box);
    for (const v of values) {
      const o = el('option', '', sel);
      o.value = v;
      o.textContent = t(`route.${v}` as Parameters<typeof t>[0]);
    }
    sel.value = get();
    const n = el('div', 'info', box);
    const showNote = () => (n.textContent = note?.(get()) ?? '');
    showNote();
    sel.addEventListener('change', () => {
      set(sel.value as T);
      saveRoute(rs);
      showNote();
    });
  };
  pick(t('route.mode'), AI_MODES, () => rs.mode, (v) => (rs.mode = v));
  pick(t('route.depth'), CLAUDE_DEPTHS, () => rs.depth, (v) => (rs.depth = v), (v) => (v === 'fable' ? t('route.fableNote') : ''));

  el('label', '', box).textContent = t('claude.title');
  el('div', 'info', box).textContent = t('claude.help');
  const kinfo = el('div', 'info', box);
  const kbtn = el('button', 'btn', box);
  kbtn.textContent = t('claude.check');
  kbtn.addEventListener('click', async () => {
    kinfo.textContent = t('ai.testing');
    const r = await claudeInfo(cfg);
    if (r === 'denied') kinfo.textContent = t('cloud.denied');
    else if (r === 'net') kinfo.textContent = t('ai.fail');
    else if (r === 'old') kinfo.textContent = t('claude.old');
    else if (!r.enabled) kinfo.textContent = t('claude.off');
    else if (r.fake) kinfo.textContent = t('claude.fake');
    else if (!r.ready) kinfo.textContent = t('cloud.nokey');
    else
      kinfo.textContent = t('claude.usage', {
        d: Math.round(r.dayUsd * 150),
        dmax: Math.round(r.daily * 150),
        m: Math.round(r.monthUsd * 150),
        mmax: Math.round(r.monthly * 150),
      });
  });

  // 語音與 AI 診斷（只在記憶體）：卡在哪一步、哪個 AI 回答、花多久
  el('label', '', box).textContent = t('diag.title');
  el('div', 'info', box).textContent = t('diag.help');
  const diag = el('div', 'info ai-notes', box);
  const showDiag = () => {
    const now = performance.now();
    const marks = hearTrace.marks
      .slice(-10)
      .map((m) => `${Math.round((now - m.at) / 1000)}s ${m.stage}${m.detail ? ` ${m.detail}` : ''}`)
      .reverse();
    diag.textContent = [
      `STT: ${hearInfo.stt || '-'} · ${hearInfo.lang || '-'}`,
      hearTrace.summary(),
      ...marks,
      `AI: ${aiDiag.source || '-'} · ${aiDiag.model || '-'} · ${aiDiag.why || '-'} · tried ${aiDiag.tried.join('>') || '-'}${aiDiag.fallback ? ' (fallback)' : ''}`,
      `    ${aiDiag.ms}ms · tokens ${aiDiag.tokens || '-'} · ${aiDiag.result || '-'} · ${aiDiag.reqId || '-'}`,
      `control: ${hearInfo.control || '-'} · epoch ${hearInfo.epoch}`,
    ].join('\n');
  };
  showDiag();
  const dbtn = el('button', 'btn', box);
  dbtn.textContent = '↻';
  dbtn.addEventListener('click', showDiag);

  const mem = loadMemory();
  const memInfo = el('div', 'info', box);
  const showMem = () => (memInfo.textContent = t('ai.memory', { n: mem.notes.length, m: mem.turns.length }));
  showMem();
  if (mem.notes.length) {
    const list = el('div', 'info ai-notes', box);
    list.textContent = mem.notes.map((n) => `・${n}`).join('\n');
  }
  const forget = el('button', 'btn', box);
  forget.textContent = t('ai.forget');
  forget.addEventListener('click', () => {
    if (!confirm(t('ai.forgetAsk'))) return;
    mem.turns = [];
    mem.notes = [];
    saveMemory(mem);
    showMem();
    box.querySelector('.ai-notes')?.remove();
  });
}
