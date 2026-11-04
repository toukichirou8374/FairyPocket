import './style.css';
import * as THREE from 'three';
import { registerSW } from 'virtual:pwa-register';
import { Stage, type Throwable } from './three/stage';
import { AllayModel } from './three/allayModel';
import { AllayController, TRAITS } from './three/allayController';
import { Hud } from './ui/hud';
import { pickLine, type LineKind } from './game/dialogue';
import { applyElapsed, BEDTIMES, cheer, createPet, moodLevel, reunionKind, type Bedtime, FAVORITE_FOOD, feed, FOOD_IDS, FRIEND_STAY_MS, isNight, MAX_FRIENDS, PERSONALITY_COLOR, PERSONALITY_IDS, pet as petPet, play, tickPet, type Food, type PetState } from './game/state';
import { BACKUP_KEY, decodeLink, encodeLink, exportFileName, linkKind, loadPet, parseSave, SAVE_KEY, serialize, storePet } from './game/save';
import { deletePack, loadImages, loadPack, readPackFile, savePack, type AssetPack } from './game/assets';
import { Sound } from './audio';
import { itemName, loadLang, saveLang, setLang, t } from './i18n';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLDivElement;
const sky = document.getElementById('sky') as HTMLDivElement;

setLang(loadLang(localStorage, navigator.language, !!localStorage.getItem(SAVE_KEY)));

const stage = new Stage(canvas);
const pet = loadPet(localStorage) ?? createPet();
const awayMs = Date.now() - pet.lastSeen;
applyElapsed(pet, awayMs);

const BEDTIME_KEY = 'fairypocket.bedtime.v1';
let bedtime: Bedtime = (BEDTIMES as readonly number[]).includes(Number(localStorage.getItem(BEDTIME_KEY))) ? (Number(localStorage.getItem(BEDTIME_KEY)) as Bedtime) : 22;
let night = isNight(new Date(), bedtime);
const model = new AllayModel();
stage.scene.add(model.root);

const sound = new Sound(localStorage);
let lastSpoke = 0;
const say = (kind: LineKind, food?: Food) => {
  hud.say(pickLine(kind, pet.personality, pet.name, Math.random, food ? itemName(food) : ''));
  sound.speak(pet.personality);
  lastSpoke = performance.now();
};

/** 悅靈接住丟過來的東西 */
function caught(): void {
  const kind = stage.ball?.kind;
  stage.removeBall();
  if (!kind) return;
  if (kind === 'slime') {
    play(pet);
    say('play');
    return;
  }
  // 食物：悅靈認得是什麼，接住後吃掉
  if (feed(pet, kind) === 'ok') {
    ctrl.eat();
    model.holdItem(stage.itemTexture(kind));
    setTimeout(() => model.holdItem(null), 1400);
    say(FAVORITE_FOOD[pet.personality] === kind ? 'favorite' : 'fedFood', kind);
  } else say('fullFood', kind);
}

const ctrl = new AllayController(
  model,
  { camera: stage.camera, bounds: () => stage.bounds(), night: () => night },
  pet,
  {
    say,
    particle: (kind, at, count, color, spread) => stage.spawn(kind, at, count, color, spread),
    caught,
  },
);

// ---------- 複製出來的悅靈夥伴 ----------

interface Friend {
  model: AllayModel;
  ctrl: AllayController;
  pet: PetState;
  /** 什麼時候飛走（performance.now） */
  leaveAt: number;
}
const friends: Friend[] = [];
let skin: CanvasImageSource | null = null;

function addFriend(at: THREE.Vector3): void {
  const m = new AllayModel();
  if (skin) m.setSkin(skin);
  stage.scene.add(m.root);
  const p = createPet();
  p.personality = PERSONALITY_IDS[Math.floor(Math.random() * PERSONALITY_IDS.length)];
  p.onboarded = true;
  const c = new AllayController(m, { camera: stage.camera, bounds: () => stage.bounds(), night: () => night }, p, {
    say: () => {},
    particle: (kind, pos, count, color, spread) => stage.spawn(kind, pos, count, color, spread),
    caught: () => {},
  });
  c.pos.copy(at);
  c.anchor.copy(at);
  friends.push({ model: m, ctrl: c, pet: p, leaveAt: performance.now() + FRIEND_STAY_MS });
  applyGlow();
}

/** 夥伴飛走：化成一陣閃光消失 */
function removeFriend(f: Friend): void {
  stage.spawn('sparkle', f.ctrl.pos, 10);
  stage.spawn('dust', f.ctrl.pos, 8, PERSONALITY_COLOR[f.pet.personality], 0.4);
  stage.scene.remove(f.model.root);
  friends.splice(friends.indexOf(f), 1);
}

/** 重新開始、還原存檔時，暫時的夥伴都先飛走 */
function clearFriends(): void {
  while (friends.length) removeFriend(friends[0]);
}

/** 原版複製冷卻 5 分鐘 */
const DUPLICATE_COOLDOWN = 5 * 60_000;
let lastDuplicate = -Infinity;

/** 跳舞中的悅靈收到紫水晶碎片：複製出一隻新夥伴 */
function giveShard(): void {
  if (friends.length >= MAX_FRIENDS) return hud.showItem(t('friendsMax'));
  const wait = lastDuplicate + DUPLICATE_COOLDOWN - performance.now();
  if (wait > 0) return hud.showItem(t('friendsWait', { n: Math.ceil(wait / 60_000) }));
  lastDuplicate = performance.now();
  addFriend(ctrl.pos.clone().add(new THREE.Vector3(0.4, 0, 0)));
  stage.spawn('heart', ctrl.headTop(new THREE.Vector3()), 4);
  stage.spawn('sparkle', ctrl.pos, 12);
  sound.effect('sounds/block/amethyst/shimmer', 1, 1);
  say('duplicate');
}

/** 音符盒：點地面放下或搬過去，點到方塊就彈奏 */
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24]; // 五聲音階，聽起來都和諧
function useNoteBlock(ray: THREE.Ray, hitBlock: boolean): void {
  if (!hitBlock || !stage.noteBlock) {
    const t = -ray.origin.y / ray.direction.y;
    if (!(t > 0)) return;
    const p = ray.at(t, new THREE.Vector3());
    const b = stage.bounds();
    p.x = THREE.MathUtils.clamp(p.x, b.minX, b.maxX);
    p.z = THREE.MathUtils.clamp(p.z, b.minZ, b.maxZ);
    stage.placeNoteBlock(p);
  }
  const block = stage.noteBlock!;
  stage.bumpNoteBlock();
  const note = SCALE[Math.floor(Math.random() * SCALE.length)];
  sound.effect('sounds/note/harp', 0.9, Math.pow(2, (note - 12) / 12));
  stage.spawn('note', block.position.clone().add(new THREE.Vector3(0, 0.35, 0)), 1);
  // 悅靈與夥伴飛過來跳舞
  const wasDancing = ctrl.dancing;
  const top = block.position.clone().add(new THREE.Vector3(0, 0.95, 0));
  if (!ctrl.dancing) cheer(pet, 4);
  ctrl.dance(top);
  friends.forEach((f, i) => f.ctrl.dance(top.clone().add(new THREE.Vector3(Math.cos(i * 2.1) * 0.7, 0.15 * i, Math.sin(i * 2.1) * 0.5))));
  if (!wasDancing && ctrl.dancing) say('dance');
}

const hud = new Hud(overlay, {
  select: (slot) => {
    if (slot !== 'note') stage.removeNoteBlock();
  },
  call: () => ctrl.call(),
  rename: (name) => {
    pet.name = name;
    hud.setName(name);
    save();
    say('greet');
  },
  setPersonality: (p) => {
    pet.personality = p;
    applyGlow();
    save();
    say('greet');
  },
  setLang: (l) => {
    saveLang(localStorage, l);
    save();
    location.reload();
  },
  bedtime: () => bedtime,
  setBedtime: (b) => {
    bedtime = b;
    localStorage.setItem(BEDTIME_KEY, String(b));
    updateSky();
  },
  glow: () => glowOn,
  setGlow: (on) => {
    glowOn = on;
    localStorage.setItem(GLOW_KEY, on ? '1' : '0');
    applyGlow();
  },
  soundMode: () => sound.mode,
  setSoundMode: (m) => {
    sound.setMode(m);
    if (m !== 'off') sound.speak(pet.personality);
  },
  soundAvailable: () => sound.available,
  exportSave,
  importSave,
  shareLink,
  pasteLink,
  reset: () => {
    localStorage.removeItem(SAVE_KEY);
    localStorage.removeItem(BACKUP_KEY);
    Object.assign(pet, createPet());
    clearFriends();
    stage.removeBall();
    ctrl.setMode('idle');
    hud.setName(pet.name);
    hud.openOnboarding();
  },
  onboard: (name, p) => {
    pet.name = name;
    pet.personality = p;
    pet.onboarded = true;
    applyGlow();
    hud.setName(name);
    save();
    setTimeout(() => say('greet'), 600);
  },
  importAssets: async (file) => {
    hud.toast(t('packImporting'));
    try {
      const p = await readPackFile(file);
      await savePack(p);
      localStorage.removeItem(OPT_OUT_KEY);
      await applyPack(p);
      hud.toast(t('packDone', { v: p.source }));
    } catch (e) {
      hud.toast((e as Error).message);
    }
  },
  clearAssets: async () => {
    await deletePack().catch(() => {});
    localStorage.setItem(OPT_OUT_KEY, '1');
    save();
    location.reload();
  },
  assetSource: () => pack?.source ?? null,
});

// ---------- 發光輪廓（個性代表色） ----------

const GLOW_KEY = 'fairypocket.glow.v1';
let glowOn = localStorage.getItem(GLOW_KEY) !== '0';

function applyGlow(): void {
  model.setGlow(glowOn ? PERSONALITY_COLOR[pet.personality] : null);
  for (const f of friends) f.model.setGlow(glowOn ? PERSONALITY_COLOR[f.pet.personality] : null);
}

// ---------- 原版素材 ----------

let pack: AssetPack | null = null;

async function applyPack(p: AssetPack): Promise<void> {
  const img = await loadImages(p);
  const food = await loadImages(p, Object.fromEntries(FOOD_IDS.map((f) => [f, `textures/item/${f}.png`])) as Record<Food, string>);
  pack = p;
  sound.usePack(p);
  if (img.allay) {
    skin = img.allay;
    model.setSkin(img.allay);
    friends.forEach((f) => f.model.setSkin(img.allay!));
  }
  if (img.note_block) stage.useNoteBlockImage(img.note_block);
  stage.useImages(img);
  stage.useFoodImages(food);
  hud.useImages(img);
  hud.useFoodImages(food);
}

const OPT_OUT_KEY = 'fairypocket.assets.optout';

/** 本機開發或預覽伺服器會提供 private/ 裡最新的素材包（建置與公開網站不含此檔） */
async function localPack(): Promise<void> {
  if (localStorage.getItem(OPT_OUT_KEY) === '1') return;
  const head = await fetch('local-pack.zip', { method: 'HEAD', cache: 'no-store' });
  const id = head.ok && head.headers.get('x-pack-id');
  if (!id || id === pack?.id) return;
  const p = await readPackFile(await (await fetch('local-pack.zip', { cache: 'no-store' })).blob());
  p.id = id;
  await savePack(p);
  await applyPack(p);
}

hud.getPet = () => pet;
hud.setName(pet.name);
applyGlow();
hud.updateStats(pet);

(async () => {
  const p = await loadPack();
  if (p) await applyPack(p);
  // 先讀完素材包，開場畫面才知道要不要提示匯入
  if (!pet.onboarded) hud.openOnboarding();
  await localPack().catch(() => {});
})();
// 重逢：離開越久，回來時越開心（離開時心情會慢慢變差，見到你就好起來）
if (pet.onboarded) {
  const kind = reunionKind(awayMs);
  setTimeout(() => {
    if (kind === 'missed' || kind === 'longAway') {
      ctrl.call();
      cheer(pet, kind === 'longAway' ? 30 : 20);
      stage.spawn('heart', ctrl.headTop(new THREE.Vector3()), kind === 'longAway' ? 6 : 3);
    } else if (kind === 'welcomeBack') cheer(pet, 10);
    say(kind);
  }, 1200);
}

// ---------- 存檔 ----------

function save(): void {
  storePet(localStorage, pet);
}

async function exportSave(): Promise<void> {
  save();
  const name = exportFileName();
  const file = new File([serialize(pet)], name, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: t('saveTitle') });
      hud.toast(t('saveExported'));
      return;
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  hud.toast(t('saveDownloaded'));
}

async function importSave(file: File): Promise<void> {
  try {
    receive(parseSave(await file.text()));
  } catch (e) {
    hud.toast((e as Error).message);
  }
}

/** 送出連動碼：用分享選單傳到另一台裝置（不支援時複製到剪貼簿） */
async function shareLink(): Promise<void> {
  save();
  const code = await encodeLink(pet);
  try {
    if (navigator.share) {
      await navigator.share({ text: code });
      return;
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
  }
  try {
    await navigator.clipboard.writeText(code);
    hud.toast(t('linkCopied'));
  } catch {
    prompt(t('linkCopyManual'), code);
  }
}

async function pasteLink(): Promise<void> {
  const code = prompt(t('linkPrompt'));
  if (!code) return;
  try {
    receive(await decodeLink(code));
  } catch {
    hud.toast(t('linkBad'));
  }
}

/** 收到另一台裝置的存檔（連動碼或存檔檔案）：同一隻就同步，另一隻要先確認 */
function receive(data: PetState): void {
  const kind = linkKind(pet, data);
  if (kind === 'other' && !confirm(t('linkOther', { n: data.name }))) return;
  if (kind === 'same-older' && !confirm(t('linkOlder'))) return;
  Object.assign(pet, data, { onboarded: true });
  clearFriends();
  applyGlow();
  stage.removeBall();
  ctrl.setMode(pet.asleep ? 'sleep' : 'idle');
  hud.setName(pet.name);
  hud.updateStats(pet);
  save();
  hud.toast(t(kind === 'other' ? 'saveRestored' : 'linkSynced'));
}

setInterval(save, 5000);
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    hiddenAt = Date.now();
    save();
  } else if (hiddenAt && Date.now() - hiddenAt > 60_000) {
    applyElapsed(pet, Date.now() - hiddenAt);
  }
});
window.addEventListener('pagehide', save);
navigator.storage?.persist?.().catch(() => {});

registerSW({
  immediate: true,
  onOfflineReady: () => hud.toast(t('offline')),
});

// ---------- 觸控 ----------

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function rayFrom(x: number, y: number): THREE.Ray {
  const r = canvas.getBoundingClientRect();
  ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, stage.camera);
  return raycaster.ray;
}

function hitsAllay(x: number, y: number): boolean {
  rayFrom(x, y);
  return raycaster.intersectObject(model.hitbox, false).length > 0;
}

function throwAt(kind: Throwable, ray: THREE.Ray, power: number): void {
  const from = stage.camera.position.clone().add(new THREE.Vector3(0, -0.7, -0.6));
  stage.throwItem(kind, from, ray.direction, power);
  ctrl.chaseBall();
}

/** 史萊姆球：按住蓄力（最多 1.2 秒），放開時依蓄力程度決定距離 */
const CHARGE_TIME = 1.2;
let chargeStart: number | null = null;
const chargeLevel = () => (chargeStart === null ? 0 : Math.min(1, (performance.now() - chargeStart) / 1000 / CHARGE_TIME));

function tap(x: number, y: number): void {
  const hit = hitsAllay(x, y);
  const ray = raycaster.ray;
  const sel = hud.selected;
  if (sel === 'note') {
    // 跳舞中點悅靈 = 送紫水晶碎片；其他時候點哪裡都是放下 / 彈奏音符盒
    if (hit && ctrl.dancing) return giveShard();
    const hitBlock = !!stage.noteBlock && raycaster.intersectObject(stage.noteBlock, false).length > 0;
    return useNoteBlock(ray, hitBlock);
  }
  if (sel === 'food' && hud.food) {
    // 食物不蓄力，輕輕拋給悅靈接
    throwAt(hud.food, ray, 0);
    return;
  }
  if (sel === 'feather') {
    if (!hit) return hud.showItem(t('featherMiss'));
    play(pet);
    ctrl.tickled();
    say('tickle');
    return;
  }
  if (hit) {
    petPet(pet);
    if (ctrl.petted()) say('pet');
    return;
  }
  // 點空白處：悅靈好奇地飛過去
  const dist = (ctrl.pos.z - ray.origin.z) / ray.direction.z;
  if (dist > 0) ctrl.lookAt(ray.at(dist, new THREE.Vector3()));
}

// iOS 需在使用者第一次觸控時啟用音訊
document.addEventListener('pointerdown', () => sound.unlock(), { capture: true });

let down: { x: number; y: number; t: number; moved: number; rub: number } | null = null;
let lastRubPet = 0;
canvas.addEventListener('pointerdown', (e) => {
  down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0, rub: 0 };
  if (hud.selected === 'slime') chargeStart = performance.now();
});
canvas.addEventListener('pointermove', (e) => {
  if (!down) return;
  const d = Math.hypot(e.movementX, e.movementY);
  down.moved += d;
  // 在悅靈身上來回滑動 = 摸摸
  if (!hud.selected && hitsAllay(e.clientX, e.clientY)) {
    down.rub += d;
    const now = performance.now();
    if (down.rub > 70 && now - lastRubPet > 700) {
      down.rub = 0;
      lastRubPet = now;
      petPet(pet);
      if (ctrl.petted() && Math.random() < 0.3) say('pet');
    }
  }
});
canvas.addEventListener('pointerup', (e) => {
  if (chargeStart !== null) {
    // 放開就丟，蓄力時手指移動也沒關係（以放開的位置決定方向）
    throwAt('slime', rayFrom(e.clientX, e.clientY), chargeLevel());
    chargeStart = null;
    hud.setCharge(null);
  } else if (down && down.moved < 14 && performance.now() - down.t < 600) tap(e.clientX, e.clientY);
  down = null;
});
canvas.addEventListener('pointercancel', () => {
  down = null;
  chargeStart = null;
  hud.setCharge(null);
});
document.addEventListener('gesturestart', (e) => e.preventDefault());

// ---------- 主迴圈 ----------

const hudEl = overlay.querySelector('.hud') as HTMLElement;
function resize(): void {
  const h = window.innerHeight;
  stage.resize(window.innerWidth, h, h - hudEl.getBoundingClientRect().top);
}
window.addEventListener('resize', resize);
new ResizeObserver(resize).observe(hudEl);
resize();

function updateSky(): void {
  night = isNight(new Date(), bedtime);
  sky.classList.toggle('night', night);
}
updateSky();
setInterval(updateSky, 60_000);

let talkIn = 15;
const tmpV = new THREE.Vector3();
let last = performance.now();
let elapsed = 0;
let statTimer = 0;

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  elapsed += dt;

  tickPet(pet, dt, night);
  ctrl.ballPos = stage.ball ? stage.ball.mesh.position : null;
  ctrl.update(dt);
  for (const f of [...friends]) {
    if (now > f.leaveAt) {
      removeFriend(f);
      continue;
    }
    tickPet(f.pet, dt, night);
    f.pet.hunger = 20; // 夥伴不需要照顧飽食度
    f.ctrl.update(dt);
  }
  stage.setShadow(ctrl.pos);
  stage.update(dt, elapsed);
  hud.setShardReady(ctrl.dancing);

  // 主動發言：每 15 秒檢查一次，距離上次發言超過 45 秒才說話
  if (ctrl.awake && pet.onboarded) {
    talkIn -= dt;
    if (talkIn <= 0) {
      talkIn = 15;
      if (now - lastSpoke > 45_000 && (ctrl.mode === 'idle' || ctrl.mode === 'approach' || ctrl.mode === 'wander')) {
        const mood = moodLevel(pet.mood);
        say(pet.hunger < 6 ? 'hungry' : pet.energy < 25 ? 'sleepy' : mood === 0 ? 'lonely' : night && Math.random() < 0.3 ? 'night' : mood === 2 && Math.random() < 0.5 ? 'happyIdle' : 'idle');
      }
    }
  }

  if (chargeStart !== null) hud.setCharge(chargeLevel());

  ctrl.headTop(tmpV).project(stage.camera);
  hud.place(((tmpV.x + 1) / 2) * window.innerWidth, ((1 - tmpV.y) / 2) * window.innerHeight, tmpV.z < 1);

  statTimer -= dt;
  if (statTimer <= 0) {
    statTimer = 0.25;
    hud.updateStats(pet);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 方便自動化測試與除錯
Object.assign(window, { __fairy: { pet, ctrl, stage, hud, TRAITS, sound } });
