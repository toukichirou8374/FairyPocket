import './style.css';
import * as THREE from 'three';
import { registerSW } from 'virtual:pwa-register';
import { Stage } from './three/stage';
import { AllayModel } from './three/allayModel';
import { AllayController, TRAITS } from './three/allayController';
import { Hud } from './ui/hud';
import { pickLine, type LineKind } from './game/dialogue';
import { applyElapsed, createPet, feed, isNight, pet as petPet, play, tickPet, type Food } from './game/state';
import { BACKUP_KEY, exportFileName, loadPet, parseSave, SAVE_KEY, serialize, storePet } from './game/save';
import { deletePack, loadImages, loadPack, readPackFile, savePack, type AssetPack } from './game/assets';
import { Sound } from './audio';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLDivElement;
const sky = document.getElementById('sky') as HTMLDivElement;

const stage = new Stage(canvas);
const pet = loadPet(localStorage) ?? createPet();
const awayMs = Date.now() - pet.lastSeen;
applyElapsed(pet, awayMs);

let night = isNight();
const model = new AllayModel();
stage.scene.add(model.root);

const sound = new Sound(localStorage);
let lastSpoke = 0;
const say = (kind: LineKind) => {
  hud.say(pickLine(kind, pet.personality, pet.name));
  sound.speak(pet.personality);
  lastSpoke = performance.now();
};

const ctrl = new AllayController(
  model,
  { camera: stage.camera, bounds: () => stage.bounds(), night: () => night },
  pet,
  {
    say,
    particle: (kind, at, count) => stage.spawn(kind, at, count),
    caught: () => {
      stage.removeBall();
      play(pet);
      say('play');
    },
  },
);

const hud = new Hud(overlay, {
  select: () => {},
  call: () => ctrl.call(),
  rename: (name) => {
    pet.name = name;
    hud.setName(name);
    save();
    say('greet');
  },
  setPersonality: (p) => {
    pet.personality = p;
    save();
    say('greet');
  },
  soundMode: () => sound.mode,
  setSoundMode: (m) => {
    sound.setMode(m);
    if (m !== 'off') sound.speak(pet.personality);
  },
  soundAvailable: () => sound.available,
  exportSave,
  importSave,
  reset: () => {
    localStorage.removeItem(SAVE_KEY);
    localStorage.removeItem(BACKUP_KEY);
    Object.assign(pet, createPet());
    stage.removeBall();
    ctrl.setMode('idle');
    hud.setName(pet.name);
    hud.openOnboarding(pet.name);
  },
  onboard: (name, p) => {
    pet.name = name;
    pet.personality = p;
    pet.onboarded = true;
    hud.setName(name);
    save();
    setTimeout(() => say('greet'), 600);
  },
  importAssets: async (file) => {
    hud.toast('正在匯入素材包…');
    try {
      const p = await readPackFile(file);
      await savePack(p);
      localStorage.removeItem(OPT_OUT_KEY);
      await applyPack(p);
      hud.toast(`已套用 Minecraft ${p.source} 原版素材`);
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

// ---------- 原版素材 ----------

let pack: AssetPack | null = null;

async function applyPack(p: AssetPack): Promise<void> {
  const img = await loadImages(p);
  pack = p;
  sound.usePack(p);
  if (img.allay) model.setSkin(img.allay);
  stage.useImages(img);
  hud.useImages(img);
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
hud.updateStats(pet);

(async () => {
  const p = await loadPack();
  if (p) await applyPack(p);
  // 先讀完素材包，開場畫面才知道要不要提示匯入
  if (!pet.onboarded) hud.openOnboarding(pet.name);
  await localPack().catch(() => {});
})();
if (pet.onboarded) setTimeout(() => say(awayMs > 3600_000 ? 'welcomeBack' : 'greet'), 1200);

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
      await navigator.share({ files: [file], title: 'FairyPocket 存檔' });
      hud.toast('已匯出存檔');
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
  hud.toast('已下載存檔');
}

async function importSave(file: File): Promise<void> {
  try {
    const data = parseSave(await file.text());
    if (!confirm(`要用「${data.name}」的存檔覆蓋目前進度嗎？`)) return;
    Object.assign(pet, data, { onboarded: true });
    stage.removeBall();
    ctrl.setMode(pet.asleep ? 'sleep' : 'idle');
    hud.setName(pet.name);
    hud.updateStats(pet);
    save();
    hud.toast('存檔已還原');
  } catch (e) {
    hud.toast((e as Error).message);
  }
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
  onOfflineReady: () => hud.toast('已可離線遊玩'),
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

function tap(x: number, y: number): void {
  const hit = hitsAllay(x, y);
  const ray = raycaster.ray;
  const sel = hud.selected;
  if (sel === 'apple' || sel === 'bread') {
    if (!hit) return hud.showItem('點一下悅靈來餵食');
    if (feed(pet, sel as Food) === 'ok') {
      ctrl.eat();
      setTimeout(() => say('fed'), 900);
    } else {
      ctrl.wake();
      say('full');
    }
    return;
  }
  if (sel === 'feather') {
    if (!hit) return hud.showItem('點一下悅靈來搔癢');
    play(pet);
    ctrl.tickled();
    say('tickle');
    return;
  }
  if (sel === 'slime') {
    const from = stage.camera.position.clone().add(new THREE.Vector3(0, -0.7, -0.6));
    stage.throwBall(from, ray.direction);
    ctrl.chaseBall();
    return;
  }
  if (hit) {
    petPet(pet);
    if (ctrl.petted()) say('pet');
    return;
  }
  // 點空白處：悅靈好奇地飛過去
  const t = (ctrl.pos.z - ray.origin.z) / ray.direction.z;
  if (t > 0) ctrl.lookAt(ray.at(t, new THREE.Vector3()));
}

// iOS 需在使用者第一次觸控時啟用音訊
document.addEventListener('pointerdown', () => sound.unlock(), { capture: true });

let down: { x: number; y: number; t: number; moved: number; rub: number } | null = null;
let lastRubPet = 0;
canvas.addEventListener('pointerdown', (e) => {
  down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0, rub: 0 };
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
  if (down && down.moved < 14 && performance.now() - down.t < 600) tap(e.clientX, e.clientY);
  down = null;
});
canvas.addEventListener('pointercancel', () => (down = null));
document.addEventListener('gesturestart', (e) => e.preventDefault());

// ---------- 主迴圈 ----------

function resize(): void {
  stage.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
resize();

function updateSky(): void {
  night = isNight();
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
  stage.setShadow(ctrl.pos);
  stage.update(dt, elapsed);

  // 主動發言：每 15 秒檢查一次，距離上次發言超過 45 秒才說話
  if (ctrl.awake && pet.onboarded) {
    talkIn -= dt;
    if (talkIn <= 0) {
      talkIn = 15;
      if (now - lastSpoke > 45_000 && (ctrl.mode === 'idle' || ctrl.mode === 'approach' || ctrl.mode === 'wander')) {
        say(pet.hunger < 6 ? 'hungry' : pet.energy < 25 ? 'sleepy' : night && Math.random() < 0.3 ? 'night' : 'idle');
      }
    }
  }

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
