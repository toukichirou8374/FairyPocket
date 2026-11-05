// 悅靈的小助理：天氣、時間、日期、計時、播音樂、查資料。
// 悅靈用說的回答；比較長的內容和要按的按鈕放在畫面上方的小卡片。
// （iPhone 規定打開別的 App 一定要使用者自己點，所以音樂、看更多都做成按鈕。）

import type { Lang } from '../i18n';
import type { Command, MusicApp } from './command';
import { firstSentences, musicUrl, NINTENDO_SHORTCUT, position, weather, weatherLine, wiki } from './services';

export type Mood = 'happy' | 'think' | 'oops' | 'alarm' | 'sad' | 'surprised' | 'shy' | 'sleepy';

export interface AssistHost {
  lang(): Lang;
  /** 悅靈說一句話（同時顯示對話泡泡、做動作） */
  say(line: string, mood: Mood): void;
}

const L = {
  zh_tw: {
    think: '我看看喔…',
    noPos: '我不知道你在哪裡耶，要允許我使用位置，才能幫你看天氣喔。',
    noWeather: '天氣查不到耶，是不是沒有網路？',
    weatherTitle: '天氣',
    source: '資料來源',
    timerSet: '好！{d}後叫你喔！',
    timerUp: '時間到了！時間到了！',
    timerTitle: '計時',
    cancel: '取消',
    music: '好喔！點一下下面的按鈕，就會打開{a}。',
    musicFind: '在 {a} 找「{q}」',
    musicOpen: '打開 {a}',
    nintendo: '要用「捷徑」打開 Nintendo Music 喔，第一次要先設定一下。',
    nintendoHelp: `第一次設定（只要做一次）：
1. 打開 iPhone 的「捷徑」App，按右上角「＋」。
2. 搜尋「打開 App」加進來，App 選「Nintendo Music」。
3. 把捷徑的名稱改成「${NINTENDO_SHORTCUT}」，按完成。
之後跟悅靈說「用 Nintendo Music 放音樂」就可以了。`,
    notFound: '我找不到「{q}」耶，換個說法試試看？',
    more: '在維基百科看更多',
    noNet: '我連不上網路耶，等一下再試試看。',
    close: '關閉',
    typeHint: '打字跟悅靈說話…',
    vidWho: '咦？這個聲音我還不認識耶！你叫什麼名字呀？',
    langHello: '好呀！我們說中文吧！',
    vidRemember: '{q}！我記住你的聲音了，以後請多多指教喔！',
    vidSecret: '好吧，那你就當我神秘的朋友吧！',
    send: '說',
  },
  ja_jp: {
    think: 'ちょっと待ってね…',
    noPos: 'どこにいるかわからないよ。位置情報を許可してくれたら、天気を調べられるよ。',
    noWeather: '天気がわからなかったよ。インターネットにつながってるかな？',
    weatherTitle: '天気',
    source: '出典',
    timerSet: 'わかった！{d}後に教えるね！',
    timerUp: '時間だよ！時間だよ！',
    timerTitle: 'タイマー',
    cancel: 'やめる',
    music: 'いいよ！下のボタンを押すと{a}が開くよ。',
    musicFind: '{a} で「{q}」をさがす',
    musicOpen: '{a} を開く',
    nintendo: 'Nintendo Music は「ショートカット」で開くよ。はじめに設定してね。',
    nintendoHelp: `はじめの設定（一回だけ）：
1. iPhone の「ショートカット」アプリを開いて、右上の「＋」を押します。
2. 「App を開く」を追加して、App は「Nintendo Music」を選びます。
3. ショートカットの名前を「${NINTENDO_SHORTCUT}」にして、完了を押します。
あとは「Nintendo Music で音楽かけて」と話しかけてね。`,
    notFound: '「{q}」は見つからなかったよ。ちがう言い方で聞いてみて？',
    more: 'ウィキペディアでもっと見る',
    noNet: 'インターネットにつながらないよ。あとでもう一回ためしてね。',
    close: '閉じる',
    typeHint: '文字で話しかける…',
    vidWho: 'あれ？この声、まだ知らないなあ。お名前は？',
    langHello: 'いいよ！日本語でお話ししよう！',
    vidRemember: '{q}！声をおぼえたよ。これからよろしくね！',
    vidSecret: 'そっか、じゃあひみつのおともだちだね！',
    send: '話す',
  },
  en_us: {
    think: 'Let me see...',
    noPos: "I don't know where you are. Let me use your location and I can check the weather!",
    noWeather: "I couldn't get the weather. Are we online?",
    weatherTitle: 'Weather',
    source: 'Source',
    timerSet: "Okay! I'll tell you in {d}!",
    timerUp: "Time's up! Time's up!",
    timerTitle: 'Timer',
    cancel: 'Cancel',
    music: 'Sure! Tap the button below to open {a}.',
    musicFind: 'Find "{q}" on {a}',
    musicOpen: 'Open {a}',
    nintendo: 'Nintendo Music opens with a Shortcut. Set it up the first time!',
    nintendoHelp: `First-time setup (just once):
1. Open the Shortcuts app on your iPhone and tap "+" at the top right.
2. Add "Open App" and choose "Nintendo Music".
3. Rename the shortcut to "${NINTENDO_SHORTCUT}" and tap Done.
Then just say "Play music on Nintendo Music".`,
    notFound: `I couldn't find "{q}". Try asking another way?`,
    more: 'See more on Wikipedia',
    noNet: "I can't reach the internet. Let's try again later.",
    close: 'Close',
    typeHint: 'Type to talk...',
    vidWho: "Huh? I don't know this voice yet. What's your name?",
    langHello: "Okay! Let's talk in English!",
    vidRemember: "{q}! I'll remember your voice. Nice to meet you!",
    vidSecret: "Okay, then you'll be my secret friend!",
    send: 'Say',
  },
} satisfies Record<Lang, Record<string, string>>;

const APP_NAME: Record<MusicApp, string> = { youtube: 'YouTube', ytmusic: 'YouTube Music', nintendo: 'Nintendo Music' };

const fill = (s: string, v: Record<string, string>): string => s.replace(/\{(\w)\}/g, (_, k: string) => v[k] ?? '');

/** 秒數 → 「5分鐘」「1小時30分鐘」 */
export function duration(sec: number, lang: Lang): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (lang === 'en_us') {
    const p: string[] = [];
    if (h) p.push(`${h} hour${h > 1 ? 's' : ''}`);
    if (m) p.push(`${m} minute${m > 1 ? 's' : ''}`);
    if (s) p.push(`${s} second${s > 1 ? 's' : ''}`);
    return p.join(' ');
  }
  const [uh, um, us] = lang === 'ja_jp' ? ['時間', '分', '秒'] : ['小時', '分鐘', '秒'];
  return `${h ? h + uh : ''}${m ? m + um : ''}${s ? s + us : ''}`;
}

/** 現在幾點（念出來的說法） */
export function timeLine(d: Date, lang: Lang): string {
  const h = d.getHours();
  const m = d.getMinutes();
  if (lang === 'en_us') return `It's ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.`;
  if (lang === 'ja_jp') return `今は${h < 12 ? '午前' : '午後'}${h % 12 || 12}時${m ? m + '分' : 'ちょうど'}だよ。`;
  const part = h < 5 ? '凌晨' : h < 12 ? '早上' : h < 13 ? '中午' : h < 18 ? '下午' : '晚上';
  return `現在是${part}${h % 12 || 12}點${m ? m + '分' : '整'}。`;
}

export function dateLine(d: Date, lang: Lang): string {
  const M = d.getMonth() + 1;
  const D = d.getDate();
  const w = d.getDay();
  if (lang === 'en_us') return `Today is ${d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}.`;
  if (lang === 'ja_jp') return `今日は${M}月${D}日、${'日月火水木金土'[w]}曜日だよ。`;
  return `今天是${M}月${D}日，星期${'日一二三四五六'[w]}。`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  parent?.appendChild(e);
  return e;
}

/** 打開別的 App 或網頁（要在使用者點按的時候呼叫） */
function openLink(url: string): void {
  if (/^https?:/.test(url)) window.open(url, '_blank', 'noopener');
  else window.location.href = url;
}

interface Timer {
  id: number;
  end: number;
  chip: HTMLDivElement;
}

export class Assistant {
  private card: HTMLDivElement;
  private timers: Timer[] = [];
  private chips: HTMLDivElement;
  /** 說話模式時的對話紀錄（像 Minecraft 的聊天欄：左下、白字、半透明黑底） */
  private chatLog: HTMLDivElement;
  private inputBar: HTMLFormElement;
  private input: HTMLInputElement;
  private tick = 0;

  constructor(
    root: HTMLElement,
    private host: AssistHost,
    /** 打字送出的話（交給跟聽到的話一樣的流程） */
    onType: (text: string) => void,
  ) {
    this.card = el('div', 'assist-card', root);
    this.chips = el('div', 'assist-timers', root);
    this.chatLog = el('div', 'assist-chat', root);
    this.inputBar = el('form', 'assist-input', root);
    this.input = el('input', '', this.inputBar);
    this.input.type = 'text';
    this.input.enterKeyHint = 'send';
    this.input.autocomplete = 'off';
    const send = el('button', '', this.inputBar);
    send.type = 'submit';
    this.inputBar.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = this.input.value.trim();
      this.input.value = '';
      this.input.blur();
      if (v) onType(v);
    });
    this.relabel();
    window.addEventListener('resize', () => this.place());
  }

  private get t(): (typeof L)['zh_tw'] {
    return L[this.host.lang()];
  }

  /** 換語言時更新固定的文字 */
  relabel(): void {
    this.input.placeholder = this.t.typeHint;
    (this.inputBar.querySelector('button') as HTMLButtonElement).textContent = this.t.send;
  }

  /** 打字欄（開著麥克風或動態模式時顯示） */
  showInput(on: boolean): void {
    this.inputBar.classList.toggle('show', on);
    this.chatLog.classList.toggle('show', on);
    if (on) this.place();
    else {
      this.input.blur();
      this.chatLog.replaceChildren();
    }
  }

  /** 現在是不是說話模式（打字欄開著） */
  get talking(): boolean {
    return this.inputBar.classList.contains('show');
  }

  /** 對話紀錄加一行「名字：內容」；10 秒後慢慢淡掉 */
  chat(name: string, text: string): void {
    const line = el('div', 'chat-line', this.chatLog);
    el('b', '', line).textContent = `${name}：`;
    line.append(text);
    while (this.chatLog.children.length > 8) this.chatLog.firstElementChild?.remove();
    setTimeout(() => line.classList.add('old'), 10_000);
    setTimeout(() => line.remove(), 12_000);
  }

  /** 打字欄放在快捷欄的上方（手機直放時快捷欄會變成兩排） */
  place(): void {
    if (!this.inputBar.classList.contains('show')) return;
    const bar = document.querySelector('.hud .stats') ?? document.querySelector('.hotbar');
    const top = bar?.getBoundingClientRect().top;
    if (top) this.inputBar.style.bottom = `${Math.max(8, window.innerHeight - top + 10)}px`;
    // 對話紀錄在打字欄的正上方
    const r = this.inputBar.getBoundingClientRect();
    if (r.height) {
      this.chatLog.style.bottom = `${window.innerHeight - r.top + 6}px`;
      this.chatLog.style.left = `${Math.max(8, r.left)}px`;
      this.chatLog.style.width = `${r.width}px`;
    }
  }

  closeCard(): void {
    this.card.classList.remove('show');
  }

  private showCard(title: string, body: string, buttons: { label: string; url?: string; act?: () => void }[] = [], foot = ''): void {
    const c = this.card;
    c.replaceChildren();
    const head = el('div', 'ac-head', c);
    el('div', 'ac-title', head).textContent = title;
    const x = el('button', 'ac-close', head);
    x.textContent = '×';
    x.setAttribute('aria-label', this.t.close);
    x.onclick = () => this.closeCard();
    if (body) el('div', 'ac-body', c).textContent = body;
    if (buttons.length) {
      const row = el('div', 'ac-buttons', c);
      for (const b of buttons) {
        const btn = el('button', 'ac-btn', row);
        btn.textContent = b.label;
        btn.onclick = () => {
          if (b.url) openLink(b.url);
          b.act?.();
        };
      }
    }
    if (foot) el('div', 'ac-foot', c).textContent = foot;
    c.classList.add('show');
  }

  /** 執行一個指令 */
  async run(cmd: Command): Promise<void> {
    const lang = this.host.lang();
    const t = this.t;
    switch (cmd.kind) {
      case 'time':
        this.host.say(timeLine(new Date(), lang), 'happy');
        return;
      case 'date':
        this.host.say(dateLine(new Date(), lang), 'happy');
        return;
      case 'timer':
        this.addTimer(cmd.seconds);
        this.host.say(fill(t.timerSet, { d: duration(cmd.seconds, lang) }), 'happy');
        return;
      case 'music': {
        const app = cmd.app ?? 'ytmusic';
        const name = APP_NAME[app];
        const label = cmd.query ? fill(t.musicFind, { a: name, q: cmd.query }) : fill(t.musicOpen, { a: name });
        if (app === 'nintendo') {
          this.host.say(t.nintendo, 'happy');
          this.showCard(name, t.nintendoHelp, [{ label: `▶ ${label}`, url: musicUrl(app, cmd.query) }]);
        } else {
          this.host.say(fill(t.music, { a: name }), 'happy');
          this.showCard(name, '', [{ label: `▶ ${label}`, url: musicUrl(app, cmd.query) }]);
        }
        return;
      }
      case 'weather': {
        this.host.say(t.think, 'think');
        const pos = await position();
        if (!pos) {
          this.host.say(t.noPos, 'oops');
          return;
        }
        const w = await weather(cmd.day, pos);
        if (!w) {
          this.host.say(t.noWeather, 'oops');
          return;
        }
        const line = weatherLine(w, lang);
        this.host.say(line, 'happy');
        this.showCard(t.weatherTitle, line, [], `${t.source}: Open-Meteo.com`);
        return;
      }
      case 'lookup': {
        this.host.say(t.think, 'think');
        if (!navigator.onLine) {
          this.host.say(t.noNet, 'oops');
          return;
        }
        const p = await wiki(cmd.query, lang);
        if (!p) {
          this.host.say(fill(t.notFound, { q: cmd.query }), 'oops');
          return;
        }
        this.host.say(firstSentences(p.extract, lang), 'happy');
        this.showCard(p.title, p.extract, [{ label: t.more, url: p.url }], `${t.source}: Wikipedia (CC BY-SA 4.0)`);
        return;
      }
    }
  }

  // ---------- 計時 ----------
  private addTimer(sec: number): void {
    const id = Date.now() + Math.random();
    const chip = el('div', 'assist-timer', this.chips);
    const label = el('span', '', chip);
    const x = el('button', '', chip);
    x.textContent = '×';
    x.setAttribute('aria-label', this.t.cancel);
    const timer: Timer = { id, end: Date.now() + sec * 1000, chip };
    x.onclick = () => this.removeTimer(timer);
    this.timers.push(timer);
    label.textContent = this.fmt(sec);
    if (!this.tick) this.tick = window.setInterval(() => this.update(), 500);
  }

  private removeTimer(timer: Timer): void {
    timer.chip.remove();
    this.timers = this.timers.filter((x) => x !== timer);
    if (!this.timers.length) {
      clearInterval(this.tick);
      this.tick = 0;
    }
  }

  private fmt(sec: number): string {
    const s = Math.max(0, Math.ceil(sec));
    const h = Math.floor(s / 3600);
    const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `⏱ ${h ? h + ':' : ''}${mm}:${ss}`;
  }

  private update(): void {
    const now = Date.now();
    for (const tm of [...this.timers]) {
      const left = (tm.end - now) / 1000;
      (tm.chip.firstChild as HTMLElement).textContent = this.fmt(left);
      if (left <= 0) {
        this.removeTimer(tm);
        this.host.say(this.t.timerUp, 'alarm');
      }
    }
  }
}

/** 換成這個語言聊天時，悅靈說的第一句 */
export function langHello(lang: Lang): string {
  return L[lang].langHello;
}

/** 認人時悅靈說的話（{q} 換成名字） */
export function voiceIdLine(lang: Lang, key: 'vidWho' | 'vidRemember' | 'vidSecret', name = ''): string {
  return fill(L[lang][key], { q: name });
}

/** 助理固定會說的話（事先做成聲音檔；有時間、數字的句子交給裝置語音） */
export function assistFixedLines(): [Lang, string][] {
  const out: [Lang, string][] = [];
  for (const lang of Object.keys(L) as Lang[]) {
    const t = L[lang];
    for (const s of [t.think, t.noPos, t.noWeather, t.timerUp, t.nintendo, t.noNet, t.vidWho, t.vidSecret, t.langHello]) out.push([lang, s]);
    for (const a of ['YouTube', 'YouTube Music']) out.push([lang, fill(t.music, { a })]);
  }
  return out;
}
