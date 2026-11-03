// 玩家自行匯入的 Minecraft 原版素材包（由 scripts/make-pack.mjs 從自己的遊戲檔產生）。
// 網站本身不含任何原版素材；素材包只存在玩家自己的裝置上。

export const ASSET_KEYS = [
  'allay', 'apple', 'bread', 'feather', 'slime_ball', 'note_block',
  'heart_full', 'heart_half', 'heart_container', 'food_full', 'food_half', 'food_empty',
  'hotbar', 'hotbar_selection', 'particle_heart', 'particle_note',
] as const;
export type AssetKey = (typeof ASSET_KEYS)[number];

/** 原版音效（entity.allay.ambient_with_item 1–4、block.amethyst_block.chime），WAV 格式 */
export const SOUND_KEYS = ['allay_with_item1', 'allay_with_item2', 'allay_with_item3', 'allay_with_item4', 'amethyst_chime'] as const;
export type SoundKey = (typeof SOUND_KEYS)[number];

/** 少了這些就無法套用 */
const REQUIRED: AssetKey[] = ['allay'];

export interface AssetPack {
  app: 'FairyPocket';
  kind: 'mc-assets';
  format: 1;
  source: string;
  files: Partial<Record<AssetKey | SoundKey, string>>;
}

export const ASSETS_KEY = 'fairypocket.assets.v1';

export function parsePack(text: string): AssetPack {
  let d: Partial<AssetPack>;
  try {
    d = JSON.parse(text);
  } catch {
    throw new Error('檔案不是有效的素材包');
  }
  if (!d || d.app !== 'FairyPocket' || d.kind !== 'mc-assets' || typeof d.files !== 'object' || !d.files) {
    throw new Error('這不是 FairyPocket 的素材包');
  }
  const files: AssetPack['files'] = {};
  for (const k of ASSET_KEYS) {
    const v = (d.files as Record<string, unknown>)[k];
    if (typeof v === 'string' && v.startsWith('data:image/png;base64,')) files[k] = v;
  }
  for (const k of SOUND_KEYS) {
    const v = (d.files as Record<string, unknown>)[k];
    if (typeof v === 'string' && v.startsWith('data:audio/wav;base64,')) files[k] = v;
  }
  for (const k of REQUIRED) if (!files[k]) throw new Error('素材包缺少悅靈貼圖');
  return { app: 'FairyPocket', kind: 'mc-assets', format: 1, source: String(d.source ?? '未知版本').slice(0, 40), files };
}

type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function loadStoredPack(storage: KV): AssetPack | null {
  try {
    const t = storage.getItem(ASSETS_KEY);
    return t ? parsePack(t) : null;
  } catch {
    return null;
  }
}

export function storePack(storage: KV, p: AssetPack): void {
  storage.setItem(ASSETS_KEY, JSON.stringify(p));
}

export function clearPack(storage: KV): void {
  storage.removeItem(ASSETS_KEY);
}

export type AssetImages = Partial<Record<AssetKey, HTMLImageElement>>;

export async function loadImages(p: AssetPack): Promise<AssetImages> {
  const out: AssetImages = {};
  await Promise.all(
    ASSET_KEYS.filter((k) => p.files[k]).map(
      (k) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            out[k] = img;
            resolve();
          };
          img.onerror = () => resolve();
          img.src = p.files[k]!;
        }),
    ),
  );
  return out;
}
