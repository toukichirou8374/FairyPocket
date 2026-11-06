// Fairy Hub：事件套用到悅靈文件的規則（純函式；呼叫前文件已是複本，失敗就整個丟掉）
// 數值規則與 FairyPocket v0.49.2 的 src/game/state.ts 相同（feed／pet／play／tickPet）。

import { clamp, fail, FAVORITE_FOOD, FOODS, LIMITS, SLEEPINESS } from './schema.mjs';

/** 記憶與對話的額度依來源分開：一個來源只會擠掉自己的舊內容，不會刪到別的來源（例如手機的私人記憶） */
export const MEMORY_QUOTA = { fp: 40, mc: 20 };
export const DIALOGUE_QUOTA = { fp: 32, mc: 32 };
export const MAX_MEMORIES = MEMORY_QUOTA.fp + MEMORY_QUOTA.mc;
export const MAX_DIALOGUE = DIALOGUE_QUOTA.fp + DIALOGUE_QUOTA.mc;

/** 只移除同一個來源最舊的項目，直到該來源不超過額度 */
function trimOwn(list, role, quota) {
  let n = list.filter((x) => x.srcRole === role).length;
  for (let i = 0; i < list.length && n > quota; ) {
    if (list[i].srcRole === role) {
      list.splice(i, 1);
      n--;
    } else i++;
  }
}
export const MAX_ADVENTURES = 500;
export const ADVENTURE_DAYS = 30;
/** 每日上限（Minecraft 事件） */
export const DAILY = { affectionMc: 10, gift: 6, found: 3, moodDown: 15 };
const RARE = new Set(['diamond', 'netherite_ingot', 'ancient_debris', 'elytra', 'totem_of_undying', 'nether_star', 'heart_of_the_sea', 'enchanted_golden_apple', 'echo_shard', 'music_disc_5', 'music_disc_otherside', 'music_disc_pigstep', 'music_disc_relic']);
const BOSSES = new Set(['ender_dragon', 'wither', 'warden', 'elder_guardian']);

const today = (now) => new Date(now).toLocaleDateString('sv-SE');

function daily(doc, now) {
  if (doc.daily?.date !== today(now)) doc.daily = { date: today(now), affectionMc: 0, gift: 0, found: 0, moodDown: 0 };
  return doc.daily;
}
const s = (doc, k, v) => (doc.state[k] = clamp(v, LIMITS[k]));

/** 從 Minecraft 來的感情加成：受每日上限限制，回傳實際加了多少 */
function mcAffection(doc, n, bucket, cap, now) {
  const d = daily(doc, now);
  const room = Math.max(0, Math.min(DAILY.affectionMc - d.affectionMc, bucket ? cap - d[bucket] : Infinity, n));
  d.affectionMc += room;
  if (bucket) d[bucket] += room;
  s(doc, 'affection', doc.state.affection + room);
  return room;
}
function mcMoodDown(doc, n, now) {
  const d = daily(doc, now);
  const room = Math.max(0, Math.min(DAILY.moodDown - d.moodDown, n));
  d.moodDown += room;
  s(doc, 'mood', doc.state.mood - room);
  return room;
}

function adventure(doc, ev, kind, detail, extra = {}) {
  doc.adventures.push({ rev: doc.rev, kind, detail, place: extra.place ?? '', with: extra.with ?? '', at: ev.at || ev.now, src: ev.role });
  const since = ev.now - ADVENTURE_DAYS * 86_400_000;
  doc.adventures = doc.adventures.filter((a) => a.at >= since).slice(-MAX_ADVENTURES);
}

/** FairyPocket 的 tickPet（dt 秒） */
export function tick(doc, dt, night) {
  const st = doc.state;
  if (st.asleep) {
    st.hunger -= dt / 240;
    st.energy += dt * 0.8;
  } else {
    st.hunger -= dt / 120;
    st.energy -= dt * 0.1 * (night ? 1.6 : 1) * (SLEEPINESS[doc.profile.personality] ?? 1);
  }
  if (st.hunger >= 17 && st.health < 20) st.health += dt / 15;
  if (st.hunger <= 0) st.health = Math.max(1, st.health - dt / 30);
  s(doc, 'hunger', st.hunger);
  s(doc, 'energy', st.energy);
  s(doc, 'health', st.health);
  if (st.asleep) st.mood += (60 - st.mood) * dt * 0.002;
  else st.mood -= dt / 150 + (st.hunger < 6 ? dt / 40 : 0) + (st.energy < 20 ? dt / 90 : 0);
  s(doc, 'mood', st.mood);
}

/**
 * 套用一筆已驗證、已通過權限／epoch／revision 檢查的事件。
 * ev = { type, payload, at, role, source, now }；回傳給用戶端的結果摘要。
 */
export function applyEvent(doc, ev) {
  const p = ev.payload;
  const st = doc.state;
  switch (ev.type) {
    case 'FED': {
      if (st.hunger >= 19.5) return { result: 'full' };
      const [hunger, health] = FOODS[p.food] ?? [2, 1];
      s(doc, 'hunger', st.hunger + hunger);
      s(doc, 'health', st.health + health);
      const fav = FAVORITE_FOOD[doc.profile.personality] === p.food;
      if (ev.role === 'mc') mcAffection(doc, fav ? 6 : 3, null, 0, ev.now);
      else s(doc, 'affection', st.affection + (fav ? 6 : 3));
      s(doc, 'mood', st.mood + (fav ? 12 : 6));
      doc.stats.fed++;
      return { result: 'ok' };
    }
    case 'PETTED':
      if (ev.role === 'mc') mcAffection(doc, 1.5, null, 0, ev.now);
      else s(doc, 'affection', st.affection + 1.5);
      s(doc, 'mood', st.mood + 3);
      doc.stats.petted++;
      return { result: 'ok' };
    case 'PLAYED':
      if (ev.role === 'mc') mcAffection(doc, 4, null, 0, ev.now);
      else s(doc, 'affection', st.affection + 4);
      s(doc, 'mood', st.mood + 8);
      s(doc, 'energy', st.energy - 3);
      s(doc, 'hunger', st.hunger - 0.5);
      doc.stats.played++;
      return { result: 'ok' };
    case 'TIME_PASSED':
      // 分段套用，跟手機每幀計算的結果接近
      for (let left = p.seconds; left > 0; left -= 1) tick(doc, Math.min(1, left), p.night);
      return { result: 'ok' };
    case 'GIFT': {
      const added = mcAffection(doc, 2, 'gift', DAILY.gift, ev.now);
      s(doc, 'mood', st.mood + 5);
      adventure(doc, ev, 'gift', p.item);
      return { result: 'ok', affection: added };
    }
    case 'FOUND': {
      const rare = RARE.has(p.item);
      const added = rare ? mcAffection(doc, 1, 'found', DAILY.found, ev.now) : 0;
      adventure(doc, ev, 'found', p.item);
      return { result: 'ok', rare, affection: added };
    }
    case 'DEFEATED': {
      const boss = BOSSES.has(p.mob);
      if (boss) s(doc, 'mood', st.mood + 5);
      adventure(doc, ev, 'defeated', p.mob);
      return { result: 'ok', boss };
    }
    case 'HURT':
      return { result: 'ok', mood: -mcMoodDown(doc, 3, ev.now) };
    case 'DIED':
      adventure(doc, ev, 'died', '');
      return { result: 'ok', mood: -mcMoodDown(doc, 5, ev.now) };
    case 'VITALS_SYNC':
      for (const k of ['health', 'hunger', 'energy', 'mood', 'affection']) s(doc, k, p[k]);
      st.asleep = p.asleep;
      return { result: 'ok' };
    case 'MEMORY_ADD': {
      if (doc.memories.some((m) => m.memoryId === p.memoryId)) return { result: 'exists' };
      doc.memories.push({ memoryId: p.memoryId, text: p.text, visibility: p.visibility, srcRole: ev.role, srcSource: ev.source, srcOpId: ev.opId, at: ev.at || ev.now });
      trimOwn(doc.memories, ev.role, MEMORY_QUOTA[ev.role]);
      return { result: 'ok' };
    }
    case 'MEMORY_REMOVE': {
      const i = doc.memories.findIndex((m) => m.memoryId === p.memoryId);
      if (i < 0) return { result: 'missing' };
      if (doc.memories[i].srcRole !== ev.role) fail(403, 'FORBIDDEN', { where: 'memory.owner' });
      doc.memories.splice(i, 1);
      return { result: 'ok' };
    }
    case 'DIALOGUE_ADD': {
      if (doc.dialogue.some((d) => d.messageId === p.messageId)) return { result: 'exists' };
      doc.dialogue.push({ messageId: p.messageId, who: p.who, name: p.name, text: p.text, srcRole: ev.role, srcSource: ev.source, at: ev.at || ev.now });
      trimOwn(doc.dialogue, ev.role, DIALOGUE_QUOTA[ev.role]);
      return { result: 'ok' };
    }
    case 'RENAME':
      doc.profile.name = p.name;
      return { result: 'ok' };
    case 'ADVENTURE':
      adventure(doc, ev, p.kind, p.detail, p);
      return { result: 'ok' };
  }
  fail(400, 'SCHEMA', { where: 'event.type' });
}
