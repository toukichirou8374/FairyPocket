// 感應測試與靈敏度：即時顯示麥克風音量、說話門檻、聽到的話，以及前鏡頭的動作量、揮手次數。
// 在 iPhone 上實際看哪裡誤判，再用滑桿調整。畫面和聲音只在裝置上處理，不會存起來。

import { ArCamera } from '../ar';
import { t } from '../i18n';
import { sense, setSense, SENSE_MAX, SENSE_MIN, type Sense } from '../sense';
import { Recognizer, speechSupported } from '../speech';
import { Listener } from '../voice';

export interface SenseTestHost {
  root: HTMLElement;
  context(): AudioContext | null;
  /** 打開測試前，先關掉快捷欄正在用的麥克風、鏡頭 */
  pauseSenses(): void;
  speechLang(): string;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  parent?.appendChild(e);
  return e;
}

export class SenseTest {
  private listener = new Listener();
  private rec = new Recognizer();
  private cam: ArCamera | null = null;
  private raf = 0;
  private motionArea = 0;
  private waves = 0;
  private talks = 0;

  constructor(private host: SenseTestHost) {}

  open(): void {
    this.host.pauseSenses();
    const back = el('div', 'modal-back', this.host.root);
    const box = el('div', 'modal sensetest', back);
    el('h2', '', box).textContent = t('st.title');
    el('div', 'info', box).textContent = t('st.help');

    // ---- 麥克風 ----
    el('label', '', box).textContent = t('st.mic');
    this.slider(box, 'mic');
    const meter = el('div', 'st-meter', box);
    const fill = el('div', 'st-fill', meter);
    const floor = el('div', 'st-floor', meter);
    const line = el('div', 'st-line', meter);
    const micState = el('div', 'st-state', box);
    const heard = el('div', 'st-heard', box);

    // ---- 揮手 ----
    el('label', '', box).textContent = t('st.wave');
    this.slider(box, 'wave');
    const camBox = el('div', 'st-cam', box);
    const motionMeter = el('div', 'st-meter', box);
    const motionFill = el('div', 'st-fill motion', motionMeter);
    const waveState = el('div', 'st-state', box);

    const row = el('div', 'btnrow', box);
    const startBtn = el('button', 'btn', row);
    startBtn.textContent = t('st.start');
    const closeBtn = el('button', 'btn', row);
    closeBtn.textContent = t('close');

    let running = false;
    let micOk = false;
    let camOk = false;
    let talkFlash = 0;
    let waveFlash = 0;
    const draw = () => {
      const lv = this.listener.level;
      const thr = this.listener.gate.threshold();
      fill.style.width = `${Math.min(100, lv * 100)}%`;
      fill.classList.toggle('loud', lv > thr);
      line.style.left = `${Math.min(100, thr * 100)}%`;
      floor.style.width = `${Math.min(100, this.listener.gate.floor * 100)}%`;
      const now = performance.now();
      micState.textContent = !micOk
        ? ''
        : this.listener.gate.calibrating
          ? t('st.calibrating')
          : now < talkFlash
            ? `${t('st.talk')}（${this.talks}）`
            : `${t('st.listening')}（${this.talks}）`;
      micState.classList.toggle('hit', now < talkFlash);
      motionFill.style.width = `${Math.min(100, this.motionArea * 100 * 2)}%`;
      motionFill.classList.toggle('over', this.motionArea > 0.42);
      this.motionArea *= 0.85;
      if (camOk) waveState.textContent = now < waveFlash ? `${t('st.waved')}（${this.waves}）` : `${t('st.watching')}（${this.waves}）`;
      waveState.classList.toggle('hit', now < waveFlash);
      this.raf = requestAnimationFrame(draw);
    };

    const start = async () => {
      if (running) return;
      running = true;
      startBtn.disabled = true;
      const ctx = this.host.context();
      void ctx?.resume();
      // 說話偵測（音量）
      if (ctx) {
        try {
          await this.listener.start(ctx, {
            start: () => {
              this.talks++;
              talkFlash = performance.now() + 1200;
            },
            end: () => {},
          });
          micOk = true;
        } catch {
          heard.textContent = t('micDenied');
        }
      }
      // 語音辨識（聽到的字）
      if (speechSupported()) {
        this.rec.start(this.host.speechLang(), (text, final, alts) => {
          heard.textContent = `${t('st.heard')}「${text}」${final && alts.length > 1 ? `\n${t('st.alts')}${alts.slice(1).join('／')}` : ''}`;
        });
      } else heard.textContent = t('st.noSpeech');
      // 前鏡頭
      this.cam = new ArCamera(camBox, {
        wave: () => {
          this.waves++;
          waveFlash = performance.now() + 1200;
        },
        motion: () => {},
        area: (a) => (this.motionArea = Math.max(this.motionArea, a)),
      }, 'st-video');
      try {
        await this.cam.start('user');
        camOk = true;
      } catch {
        waveState.textContent = t('st.noCam');
      }
    };

    const close = () => {
      cancelAnimationFrame(this.raf);
      this.listener.stop();
      this.rec.stop();
      this.cam?.stop();
      this.cam?.video.remove();
      this.cam = null;
      back.remove();
    };
    startBtn.onclick = () => void start();
    closeBtn.onclick = close;
    this.raf = requestAnimationFrame(draw);
  }

  private slider(box: HTMLElement, k: keyof Sense): HTMLInputElement {
    const row = el('div', 'vol', box);
    const top = el('div', 'vtop', row);
    el('span', '', top).textContent = t('st.sens');
    const val = el('span', 'vval', top);
    const r = el('input', '', row);
    r.type = 'range';
    r.min = String(SENSE_MIN * 100);
    r.max = String(SENSE_MAX * 100);
    r.step = '5';
    r.value = String(Math.round(sense[k] * 100));
    const show = () => (val.textContent = `${r.value}%`);
    show();
    r.addEventListener('input', () => {
      setSense(k, Number(r.value) / 100);
      show();
    });
    return r;
  }
}
