// 方塊類的圖示畫成原版物品欄那樣的斜角立體（上面、左前、右側三個面）。
// 用原版材質在畫布上做仿射變換，左前面稍暗、右側更暗，跟遊戲裡的光照一樣。

/** 一個面的材質：整張圖或圖上的一塊 */
export interface Face {
  img: CanvasImageSource;
  sx?: number;
  sy?: number;
  sw?: number;
  sh?: number;
}

const C = Math.cos(Math.PI / 6);
const S = Math.sin(Math.PI / 6);

function size(f: Face): [number, number] {
  const img = f.img as HTMLImageElement | HTMLCanvasElement;
  return [f.sw ?? img.width, f.sh ?? img.height];
}

/** 把一個面先畫成小畫布並調暗（shade = 亮度 0–1） */
function shaded(f: Face, shade: number): HTMLCanvasElement {
  const [w, h] = size(f);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(f.img, f.sx ?? 0, f.sy ?? 0, w, h, 0, 0, w, h);
  if (shade < 1) {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = `rgba(0,0,0,${1 - shade})`;
    ctx.fillRect(0, 0, w, h);
  }
  return c;
}

/**
 * 畫一個斜角立體的方塊。
 * x = 左前面的寬、z = 右側面的寬、y = 高（都用原版的像素，一格方塊 = 16）。
 * top 的材質下緣接在左前面上緣。
 */
export function isoIcon(top: Face, left: Face, right: Face, x = 16, y = 16, z = 16, out = 64): string {
  const c = document.createElement('canvas');
  c.width = c.height = out;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  // 一格方塊剛好放滿；比較大的東西（例如床）縮小放進去
  const k = Math.min(out / 32, (out * 0.96) / ((x + z) * C), (out * 0.96) / (y + (x + z) * S));
  const fx = out / 2 + ((x - z) * C * k) / 2;
  const fy = out / 2 + ((y + (x + z) * S) * k) / 2;
  const draw = (f: Face, shade: number, ux: number, uy: number, vx: number, vy: number, ox: number, oy: number, uLen: number, vLen: number) => {
    const img = shaded(f, shade);
    // 稍微放大一點點，避免面與面之間出現細縫
    const e = 1.01;
    ctx.setTransform((ux * uLen * e) / img.width, (uy * uLen * e) / img.width, (vx * vLen * e) / img.height, (vy * vLen * e) / img.height, ox, oy);
    ctx.drawImage(img, 0, 0);
  };
  // 左前面：左邊的角 → 最前面的角
  draw(left, 0.8, C, S, 0, 1, fx - x * C * k, fy - x * S * k - y * k, x * k, y * k);
  // 右側面：最前面的角 → 右邊的角
  draw(right, 0.6, C, -S, 0, 1, fx, fy - y * k, z * k, y * k);
  // 上面：材質左上角在最後面偏左的角
  draw(top, 1, C, S, -C, S, fx - x * C * k + z * C * k, fy - y * k - x * S * k - z * S * k, x * k, z * k);
  return c.toDataURL();
}

/** 整個方塊同一種材質（例如音階盒） */
export function isoCube(top: HTMLImageElement, side: HTMLImageElement = top, right: HTMLImageElement = side): string {
  return isoIcon({ img: top }, { img: side }, { img: right });
}

function sub(w: number, h: number, fn: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  fn(ctx);
  return c;
}

/** 原版箱子（entity/chest/normal.png，64×64）：蓋子 14×5×14 + 箱身 14×10×14 + 鎖扣 */
export function chestIso(tex: HTMLImageElement): string {
  const k = tex.width / 64;
  const g = (ctx: CanvasRenderingContext2D, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number) =>
    ctx.drawImage(tex, sx * k, sy * k, sw * k, sh * k, dx, dy, sw, sh);
  // 正面（蓋子 5 + 箱身 10，蓋子蓋住箱身最上面 1 像素）
  const front = sub(14, 14, (ctx) => {
    g(ctx, 14, 34, 14, 9, 0, 5);
    g(ctx, 14, 14, 14, 5, 0, 0);
    g(ctx, 1, 1, 2, 4, 6, 3);
  });
  const side = sub(14, 14, (ctx) => {
    g(ctx, 0, 34, 14, 9, 0, 5);
    g(ctx, 0, 14, 14, 5, 0, 0);
  });
  const top = sub(14, 14, (ctx) => g(ctx, 28, 0, 14, 14, 0, 0));
  return isoIcon({ img: top }, { img: front }, { img: side }, 14, 14, 14);
}

/** 原版紅色床（兩格長、9 像素高）：左前面是床的側面，右側是床尾 */
export function bedIso(i: { head_up: HTMLImageElement; foot_up: HTMLImageElement; head_side: HTMLImageElement; foot_side: HTMLImageElement; foot_end: HTMLImageElement }): string {
  const t = i.head_up.width / 16;
  // 上面：床頭在遠處（左），床尾在近處（右）；兩張 16×16 各轉 90° 接成 32×16
  const top = sub(32, 16, (ctx) => {
    for (const [img, dx] of [[i.head_up, 0], [i.foot_up, 16]] as const) {
      ctx.save();
      ctx.translate(dx, 16);
      ctx.rotate(-Math.PI / 2);
      ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, 16, 16);
      ctx.restore();
    }
  });
  // 側面：材質下半部 9 像素
  const side = sub(32, 9, (ctx) => {
    ctx.drawImage(i.head_side, 0, 7 * t, 16 * t, 9 * t, 0, 0, 16, 9);
    ctx.drawImage(i.foot_side, 0, 7 * t, 16 * t, 9 * t, 16, 0, 16, 9);
  });
  const end = sub(16, 9, (ctx) => ctx.drawImage(i.foot_end, 0, 7 * t, 16 * t, 9 * t, 0, 0, 16, 9));
  return isoIcon({ img: top }, { img: side }, { img: end }, 32, 9, 16);
}
