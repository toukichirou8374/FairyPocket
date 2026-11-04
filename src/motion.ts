// 體感（精靈舞蹈的「體感」玩法）：前鏡頭的畫面當背景，比對前後兩張縮小的畫面找出「哪裡在動」。
// 遊戲問「悅靈所在的位置附近有沒有在動」，有的話就是小朋友的手揮到悅靈了。
// 畫面只在裝置上處理，不會上傳或存檔。

const GW = 48;
const GH = 36;
/** 亮度差多少算有動 */
const DIFF = 26;

export class MotionTracker {
  readonly video: HTMLVideoElement;
  private stream: MediaStream | null = null;
  private small = document.createElement('canvas');
  private prev: Uint8ClampedArray | null = null;
  private changed = new Uint8Array(GW * GH);
  private timer = 0;

  constructor(parent: HTMLElement) {
    this.video = document.createElement('video');
    this.video.id = 'motion-cam';
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.autoplay = true;
    parent.prepend(this.video);
    this.small.width = GW;
    this.small.height = GH;
  }

  get on(): boolean {
    return !!this.stream;
  }

  /** 開前鏡頭；失敗（沒有鏡頭或不允許）回傳 false */
  async start(): Promise<boolean> {
    this.stop();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 540 } }, audio: false });
    } catch {
      return false;
    }
    this.video.srcObject = this.stream;
    await this.video.play().catch(() => {});
    this.prev = null;
    this.timer = window.setInterval(() => this.sample(), 90);
    return true;
  }

  stop(): void {
    window.clearInterval(this.timer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.changed.fill(0);
  }

  private sample(): void {
    const v = this.video;
    if (v.readyState < 2) return;
    const ctx = this.small.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(v, 0, 0, GW, GH);
    const d = ctx.getImageData(0, 0, GW, GH).data;
    const gray = new Uint8ClampedArray(GW * GH);
    for (let i = 0; i < gray.length; i++) gray[i] = (d[i * 4] + d[i * 4 + 1] * 2 + d[i * 4 + 2]) >> 2;
    if (this.prev) for (let i = 0; i < gray.length; i++) this.changed[i] = Math.abs(gray[i] - this.prev[i]) > DIFF ? 1 : 0;
    this.prev = gray;
  }

  /** 整個鏡頭畫面在動的比例（0–1） */
  overall(): number {
    let n = 0;
    for (let i = 0; i < this.changed.length; i++) n += this.changed[i];
    return n / this.changed.length;
  }

  /**
   * 畫面上某一點附近在動的比例（0–1）。
   * sx、sy 是畫面上的位置（0–1，左上為 0），r 是半徑（畫面寬度的比例）。
   * 鏡頭畫面以「填滿、鏡像」顯示，這裡把畫面位置換回鏡頭畫面上的位置。
   */
  activity(sx: number, sy: number, r: number): number {
    const v = this.video;
    const vw = v.videoWidth;
    const vh = v.videoHeight;
    if (!vw || !vh) return 0;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const k = Math.max(W / vw, H / vh);
    const ox = (W - vw * k) / 2;
    const oy = (H - vh * k) / 2;
    // 畫面座標 → 鏡頭畫面座標（0–1），前鏡頭左右相反
    const vx = 1 - (sx * W - ox) / k / vw;
    const vy = (sy * H - oy) / k / vh;
    const rx = (r * W) / k / vw;
    const ry = (r * W) / k / vh;
    let n = 0;
    let hit = 0;
    for (let y = 0; y < GH; y++) {
      const dy = ((y + 0.5) / GH - vy) / ry;
      if (Math.abs(dy) > 1) continue;
      for (let x = 0; x < GW; x++) {
        const dx = ((x + 0.5) / GW - vx) / rx;
        if (dx * dx + dy * dy > 1) continue;
        n++;
        hit += this.changed[y * GW + x];
      }
    }
    return n ? hit / n : 0;
  }
}
