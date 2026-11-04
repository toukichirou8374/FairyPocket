// 相機 AR 模式（B，PWA 的簡化版）：用相機畫面當背景，悅靈照常在上面飛、可以餵食與互動。
// 可以拍照、錄影（含悅靈的聲音），前後鏡頭切換；前鏡頭時會偵測畫面裡的動作，
// 對著鏡頭揮手悅靈會揮手回應。相機畫面只在裝置上處理，不會上傳。

export type Facing = 'environment' | 'user';

export interface ArEvents {
  /** 前鏡頭偵測到揮手 */
  wave(): void;
  /** 畫面裡有明顯動作；x 是動作的位置（-1 左 ~ 1 右，已換成畫面上看到的方向） */
  motion(x: number): void;
}

/** 揮手判斷：動作的左右位置在短時間內來回改變方向幾次 */
export class WaveDetector {
  private xs: { t: number; x: number }[] = [];
  private lastWave = -Infinity;

  /** 每次偵測到動作時呼叫；回傳這次是不是揮手 */
  push(t: number, x: number): boolean {
    this.xs.push({ t, x });
    this.xs = this.xs.filter((p) => t - p.t < 1500);
    if (t - this.lastWave < 2500 || this.xs.length < 5) return false;
    let turns = 0, dir = 0, span = 0;
    const min = Math.min(...this.xs.map((p) => p.x)), max = Math.max(...this.xs.map((p) => p.x));
    span = max - min;
    for (let i = 1; i < this.xs.length; i++) {
      const d = this.xs[i].x - this.xs[i - 1].x;
      if (Math.abs(d) < 0.04) continue;
      const s = Math.sign(d);
      if (dir && s !== dir) turns++;
      dir = s;
    }
    if (turns >= 2 && span > 0.15) {
      this.lastWave = t;
      this.xs = [];
      return true;
    }
    return false;
  }
}

export class ArCamera {
  readonly video: HTMLVideoElement;
  facing: Facing = 'environment';
  private stream: MediaStream | null = null;
  private small = document.createElement('canvas');
  private prev: Uint8ClampedArray | null = null;
  private motionTimer = 0;
  private waves = new WaveDetector();

  constructor(parent: HTMLElement, private ev: ArEvents, id = 'cam') {
    this.video = document.createElement('video');
    this.video.id = id;
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.autoplay = true;
    parent.prepend(this.video);
    this.small.width = 32;
    this.small.height = 24;
  }

  get on(): boolean {
    return !!this.stream;
  }

  async start(facing: Facing = this.facing): Promise<void> {
    this.stop();
    this.facing = facing;
    this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    this.video.srcObject = this.stream;
    this.video.classList.toggle('mirror', facing === 'user');
    await this.video.play().catch(() => {});
    this.prev = null;
    window.clearInterval(this.motionTimer);
    // 前鏡頭：每 0.1 秒比對一次縮小的畫面，找出動作的位置
    if (facing === 'user') this.motionTimer = window.setInterval(() => this.detect(), 100);
  }

  stop(): void {
    window.clearInterval(this.motionTimer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  private detect(): void {
    const v = this.video;
    if (v.readyState < 2) return;
    const ctx = this.small.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(v, 0, 0, 32, 24);
    const d = ctx.getImageData(0, 0, 32, 24).data;
    const gray = new Uint8ClampedArray(32 * 24);
    for (let i = 0; i < gray.length; i++) gray[i] = (d[i * 4] + d[i * 4 + 1] * 2 + d[i * 4 + 2]) >> 2;
    if (this.prev) {
      let n = 0, sx = 0;
      for (let i = 0; i < gray.length; i++) {
        if (Math.abs(gray[i] - this.prev[i]) > 28) {
          n++;
          sx += i % 32;
        }
      }
      // 動作夠明顯（約 4% 以上的畫面在動）才算
      if (n > 30) {
        // 前鏡頭畫面是鏡像顯示，所以左右反過來
        const x = -((sx / n / 31) * 2 - 1);
        this.ev.motion(x);
        if (this.waves.push(performance.now(), x)) this.ev.wave();
      }
    }
    this.prev = gray;
  }

  /** 把目前的相機畫面畫進 2D 畫布（裁切成填滿，前鏡頭鏡像） */
  drawFrame(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const v = this.video;
    const vw = v.videoWidth || w, vh = v.videoHeight || h;
    const k = Math.max(w / vw, h / vh);
    const dw = vw * k, dh = vh * k;
    ctx.save();
    if (this.facing === 'user') {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(v, (w - dw) / 2, (h - dh) / 2, dw, dh);
    ctx.restore();
  }
}

/** 拍照、錄影用的合成畫布：相機畫面 + 3D 畫面 */
export class Composer {
  readonly canvas = document.createElement('canvas');
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  constructor(private cam: ArCamera, private gl: HTMLCanvasElement) {}

  /** 在 3D 畫面剛畫好的同一個時間點呼叫（WebGL 畫布之後就會被清空） */
  compose(): void {
    const w = this.gl.width, h = this.gl.height;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const ctx = this.canvas.getContext('2d')!;
    this.cam.drawFrame(ctx, w, h);
    ctx.drawImage(this.gl, 0, 0, w, h);
  }

  photo(): Promise<Blob | null> {
    return new Promise((r) => this.canvas.toBlob(r, 'image/jpeg', 0.92));
  }

  get recording(): boolean {
    return !!this.recorder;
  }

  /** 開始錄影；audio 是悅靈聲音的串流（可省略） */
  startRecording(audio?: MediaStream): void {
    const stream = this.canvas.captureStream(30);
    audio?.getAudioTracks().forEach((t) => stream.addTrack(t));
    const type = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
    this.recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    this.chunks = [];
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.recorder.start(500);
  }

  stopRecording(): Promise<Blob | null> {
    const r = this.recorder;
    if (!r) return Promise.resolve(null);
    this.recorder = null;
    return new Promise((resolve) => {
      r.onstop = () => resolve(this.chunks.length ? new Blob(this.chunks, { type: r.mimeType || 'video/mp4' }) : null);
      r.stop();
    });
  }
}

/** 存檔：iPhone 用分享選單（可以「儲存影像／影片」），其他瀏覽器直接下載 */
export async function saveMedia(blob: Blob, name: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], name, { type: blob.type });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] });
      return 'shared';
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return 'cancelled';
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  return 'downloaded';
}
