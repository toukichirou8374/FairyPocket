// 設定頁：AI 大腦（家裡電腦的本機 AI）的開關、連線網址、模型、記憶。

import { t } from '../i18n';
import { cloudInfo, listModels, loadBrain, loadMemory, saveBrain, saveMemory } from '../brain/brain';

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

  el('div', 'info', box).textContent = t('ai.url');
  const url = el('input', 'name-input', box);
  url.type = 'url';
  url.placeholder = 'https://desktop-xxxx.tailxxxx.ts.net';
  url.value = cfg.url;
  url.autocomplete = 'off';
  url.spellcheck = false;
  url.addEventListener('change', () => {
    cfg.url = url.value.trim();
    saveBrain(cfg);
  });

  el('div', 'info', box).textContent = t('ai.token');
  const token = el('input', 'name-input', box);
  token.type = 'password';
  // 存好的通行碼不再顯示（只顯示「已設定」）；要換的時候直接輸入新的
  token.placeholder = cfg.token ? t('ai.tokenSet') : 'xxxx-xxxx-xxxx-xxxx';
  token.value = '';
  token.autocomplete = 'off';
  token.spellcheck = false;
  token.addEventListener('change', () => {
    if (!token.value.trim()) return;
    cfg.token = token.value.trim();
    token.value = '';
    token.placeholder = t('ai.tokenSet');
    saveBrain(cfg);
  });

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
  const test = el('button', 'btn', box);
  test.textContent = t('ai.test');
  test.addEventListener('click', async () => {
    cfg.url = url.value.trim();
    if (token.value.trim()) {
      cfg.token = token.value.trim();
      token.value = '';
      token.placeholder = t('ai.tokenSet');
    }
    saveBrain(cfg);
    status.textContent = t('ai.testing');
    const res = await listModels(cfg);
    if (!res.ok) {
      status.textContent = t(res.why === 'url' ? 'ai.badUrl' : res.why === 'token' ? 'ai.badToken' : 'ai.fail');
      return;
    }
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
