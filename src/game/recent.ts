// 台詞不重複：同一個情境最近說過的幾句先跳過，從還沒說過的裡面挑。
// 只記在記憶體裡（重新打開 App 會重來），每個情境各自記。

const recent = new Map<string, string[]>();

/** 從 pool 挑一句，避開這個情境（key）最近說過的 */
export function pickFresh(key: string, pool: readonly string[], rnd = Math.random): string {
  const unique = [...new Set(pool)];
  if (unique.length <= 1) return pool[0] ?? '';
  // 最多記「不同台詞數 - 1」句（至少留一句可以挑），上限 6 句
  const keep = Math.min(6, unique.length - 1);
  const used = recent.get(key) ?? [];
  const fresh = pool.filter((l) => !used.includes(l));
  const list = fresh.length ? fresh : pool;
  const line = list[Math.floor(rnd() * list.length)];
  used.push(line);
  while (used.length > keep) used.shift();
  recent.set(key, used);
  return line;
}

/** 測試用：清掉記錄 */
export function clearRecent(): void {
  recent.clear();
}
