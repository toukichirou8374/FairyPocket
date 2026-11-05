// 貼紙簿的背景音樂：自己作的開朗小曲（C 大調、像鐵琴＋木琴的聲音），用 Web Audio 即時演奏、一直循環。
// 不用素材包，也沒有版權問題。

/** 一小節 8 個八分音符（MIDI 音高，0 = 休止） */
const MELODY: number[][] = [
  [76, 79, 84, 79, 81, 79, 76, 79],
  [77, 81, 84, 81, 79, 77, 76, 74],
  [74, 79, 83, 79, 81, 83, 84, 86],
  [88, 0, 84, 0, 79, 0, 0, 0],
  [84, 83, 81, 76, 81, 83, 84, 88],
  [86, 84, 81, 77, 79, 81, 84, 81],
  [83, 86, 79, 83, 81, 79, 77, 74],
  [72, 76, 79, 84, 0, 0, 0, 0],
];
/** 每小節的根音（低音每拍彈：根音、五度、根音、五度） */
const BASS = [48, 53, 55, 48, 45, 53, 55, 48];

const BPM = 132;
const LOOKAHEAD = 0.25;

const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);

export class Jingle {
  private timer = 0;
  private gain: GainNode | null = null;
  private next = 0;
  private step = 0;

  constructor(private ctx: AudioContext, private out: AudioNode, private volume = 0.32) {}

  start(): void {
    this.stop();
    const g = this.ctx.createGain();
    g.gain.value = this.volume;
    g.connect(this.out);
    this.gain = g;
    this.next = this.ctx.currentTime + 0.1;
    this.step = 0;
    this.timer = window.setInterval(() => this.schedule(), 60);
    this.schedule();
  }

  stop(): void {
    window.clearInterval(this.timer);
    this.timer = 0;
    const g = this.gain;
    if (g) {
      g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      window.setTimeout(() => g.disconnect(), 400);
    }
    this.gain = null;
  }

  duck(level: number): void {
    this.gain?.gain.setTargetAtTime(this.volume * level, this.ctx.currentTime, 0.08);
  }

  private schedule(): void {
    if (!this.gain) return;
    const eighth = 60 / BPM / 2;
    while (this.next < this.ctx.currentTime + LOOKAHEAD) {
      const bar = Math.floor(this.step / 8) % MELODY.length;
      const i = this.step % 8;
      const m = MELODY[bar][i];
      if (m) this.bell(hz(m), this.next);
      // 低音：每拍一下（根音、五度交替）
      if (i % 2 === 0) this.pluck(hz(BASS[bar] + (i % 4 === 2 ? 7 : 0)), this.next);
      // 第 1、3 拍輕輕的和弦（三度、五度）
      if (i === 0 || i === 4) {
        const third = bar === 4 ? 3 : 4;
        this.pad(hz(BASS[bar] + 12 + third), this.next);
        this.pad(hz(BASS[bar] + 19), this.next);
      }
      this.next += eighth;
      this.step++;
    }
  }

  /** 鐵琴：正弦波＋高八度，很快變小聲 */
  private bell(f: number, t: number): void {
    this.tone('sine', f, t, 0.5, 0.42);
    this.tone('sine', f * 2, t, 0.16, 0.25);
  }

  private pluck(f: number, t: number): void {
    this.tone('triangle', f, t, 0.5, 0.22);
  }

  private pad(f: number, t: number): void {
    this.tone('triangle', f, t, 0.1, 0.5);
  }

  private tone(type: OscillatorType, f: number, t: number, vol: number, len: number): void {
    if (!this.gain) return;
    const o = this.ctx.createOscillator();
    const e = this.ctx.createGain();
    o.type = type;
    o.frequency.value = f;
    e.gain.setValueAtTime(0, t);
    e.gain.linearRampToValueAtTime(vol, t + 0.005);
    e.gain.exponentialRampToValueAtTime(0.001, t + len);
    o.connect(e).connect(this.gain);
    o.start(t);
    o.stop(t + len + 0.05);
  }
}
