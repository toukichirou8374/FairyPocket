import './style.css';
import * as THREE from 'three';
import { registerSW } from 'virtual:pwa-register';
import { Stage, type Throwable } from './three/stage';
import { AllayModel } from './three/allayModel';
import { AllayController, TRAITS } from './three/allayController';
import { Hud } from './ui/hud';
import { pickLine, type LineKind } from './game/dialogue';
import { applyElapsed, BEDTIMES, cheer, MAX_HUNGER, createPet, moodLevel, reunionKind, type Bedtime, FAVORITE_FOOD, feed, FOOD_IDS, FRIEND_STAY_MS, isNight, MAX_FRIENDS, PERSONALITY_COLOR, PERSONALITY_IDS, pet as petPet, play, tickPet, type Food, type PetState } from './game/state';
import { BACKUP_KEY, decodeLink, encodeLink, exportFileName, linkKind, loadPet, parseSave, SAVE_KEY, serialize, storePet } from './game/save';
import { deletePack, loadImages, loadPack, readPackFile, savePack, type AssetPack } from './game/assets';
import { Sound } from './audio';
import { SFX, sfxPitch, type Sfx } from './sfx';
import { Music } from './music';
import { ArCamera, Composer, saveMedia, type ArEvents, type Facing } from './ar';
import { clipBuffer, Listener, loadReplies, loadVoiceStyle, recordClip, saveReplies, saveVoiceStyle, type Clip } from './voice';
import { BIOME_STYLE, biomeTextures, loadBiome, saveBiome, type Biome } from './three/biome';
import { memoryTopic, rememberFood, takeMilestone, timeGreeting, visitDay, type MilestoneLine } from './game/memory';
import { asciiGlyphs, buildFont } from './pixelFont';
import { getLang, itemName, loadLang, saveLang, setLang, t } from './i18n';

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
const music = new Music(sound, localStorage);
let lastSpoke = 0;
const say = (kind: LineKind, food?: Food | null, d: number | string = '') => {
  hud.say(pickLine(kind, pet.personality, pet.name, Math.random, food ? itemName(food) : '', undefined, d));
  sound.speak(pet.personality);
  lastSpoke = performance.now();
};

// ---------- 麥克風：選起麥克風格後一直聽，說完就回應 ----------

const listener = new Listener();
// 舊版「錄音回應」存的錄音不再使用，刪掉
/** 設定頁錄的回應（目前語言 5 句）與變聲種類 */
let replies: (Clip | null)[] = [];
void loadReplies(getLang()).then((r) => (replies = r));
let voiceStyle = loadVoiceStyle(localStorage);

async function micOn(): Promise<void> {
  sound.unlock();
  const ctx = sound.context;
  if (!ctx || listener.on) return;
  try {
    await listener.start(ctx, {
      // 有人開始說話：悅靈飛過來歪頭聽
      start: () => ctrl.listen(true),
      end: (samples, rate) => void answer(samples, rate),
    });
  } catch {
    hud.showItem(t('micDenied'));
    hud.setSelected(null);
  }
}

function micOff(): void {
  listener.stop();
  ctrl.listen(false);
}

/** 說完了：從這個語言錄好的回應隨機挑一句；沒有就用悅靈語回答 */
async function answer(samples: Float32Array, rate: number): Promise<void> {
  ctrl.listen(false);
  const ctx = sound.context;
  const ready = replies.filter((r): r is Clip => !!r);
  let len: number;
  if (ctx && ready.length) {
    // 有錄回應：隨機挑一句，變聲後播放
    len = sound.playClip(clipBuffer(ctx, ready[Math.floor(Math.random() * ready.length)], voiceStyle));
    hud.say('♪');
  } else {
    // 沒錄：用原本的悅靈叫聲＋紫水晶鈴聲回答；說得比較久，就多回幾聲
    const times = Math.min(3, 1 + Math.floor(samples.length / rate / 2));
    for (let i = 0; i < times; i++) setTimeout(() => sound.speak(pet.personality), i * 650);
    hud.say(pickLine('heard', pet.personality, pet.name));
    len = times * 0.65 + 0.8;
  }
  // 悅靈說話時先不要聽（避免聽到自己的聲音）
  listener.pausedUntil = performance.now() + (len + 0.4) * 1000;
  stage.spawn('note', ctrl.headTop(new THREE.Vector3()), 2);
  cheer(pet, 3);
  lastSpoke = performance.now();
}

// ---------- 相機 AR 模式（拍照、錄影、前鏡頭揮手） ----------

let lastGlance = 0;
const cameraEvents: ArEvents = {
  wave: () => {
    ctrl.waveBack();
    say('waveBack');
    stage.spawn('heart', ctrl.headTop(new THREE.Vector3()), 3);
    cheer(pet, 5);
  },
  // 畫面裡有人在動：悅靈好奇地往那邊看（不要太頻繁）
  motion: (x) => {
    const now = performance.now();
    if (now - lastGlance < 3000 || ctrl.mode !== 'idle') return;
    lastGlance = now;
    ctrl.lookAt(new THREE.Vector3(x * 1.6, 1.2, 0.4));
  },
};
const arCam = new ArCamera(document.body, cameraEvents);

// 揮手感應（快捷欄）：不開 AR，背景照舊，左上角顯示小小的前鏡頭畫面
const sensorBox = document.createElement('div');
sensorBox.className = 'sensor';
overlay.appendChild(sensorBox);
const sensor = new ArCamera(sensorBox, cameraEvents, 'sensor-cam');

async function sensorOn(): Promise<void> {
  if (sensor.on) return;
  try {
    await sensor.start('user');
    sensorBox.classList.add('on');
  } catch {
    hud.showItem(t('camDenied'));
    hud.setSelected(null);
  }
}

function sensorOff(): void {
  sensor.stop();
  sensorBox.classList.remove('on');
}
const composer = new Composer(arCam, canvas);
let wantPhoto = false;

function mediaName(ext: string): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `FairyPocket-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
}

async function arOpen(facing: Facing = 'environment'): Promise<void> {
  if (sensor.on) hud.setSelected(null);
  try {
    await arCam.start(facing);
  } catch {
    hud.toast(t('camDenied'));
    return;
  }
  wantPhoto = false;
  hud.setAr(true);
  stage.setAR(true);
  // 預設跟平常一樣自由行動；按「動作」選姿勢時才停下來擺姿勢
  ctrl.setPose(null);
  if (facing === 'user') hud.showItem(t('arFront'));
}

async function arClose(): Promise<void> {
  if (composer.recording) await arRecord();
  arCam.stop();
  hud.setAr(false);
  stage.setAR(false);
  ctrl.setPose(null);
  model.root.scale.setScalar(1);
  model.holdItem(null);
}

async function arRecord(): Promise<void> {
  if (composer.recording) {
    hud.setRecording(false);
    const blob = await composer.stopRecording();
    if (blob) {
      const r = await saveMedia(blob, mediaName(blob.type.includes('webm') ? 'webm' : 'mp4'));
      if (r !== 'cancelled') hud.toast(t('arSaved'));
    }
    return;
  }
  sound.unlock();
  composer.startRecording(sound.recordStream() ?? undefined);
  hud.setRecording(true);
  hud.toast(t('arRecording'));
}

/** 達成紀念次數時（第 100 次摸摸…），過一下再開心地說出來 */
function celebrate(only: MilestoneLine[]): void {
  const m = takeMilestone(pet, only);
  if (!m) return;
  save();
  setTimeout(() => {
    say(m.kind, null, m.n);
    stage.spawn('heart', ctrl.headTop(new THREE.Vector3()), 4);
    playSfx('levelup');
  }, 2600);
}

/** 播放情境音效；at 是聲音的位置（離鏡頭越遠越小聲） */
let lastFlight = 0;
function playSfx(e: Sfx, at?: THREE.Vector3): void {
  // 拍翅、衝刺不要太密集
  if (e === 'flap' || e === 'dash') {
    const now = performance.now();
    if (now - lastFlight < 2500) return;
    lastFlight = now;
  }
  const { path, vol } = SFX[e];
  if (at) sound.effectAt(path, at.distanceTo(stage.camera.position), at.x, vol, sfxPitch(e));
  else sound.effect(path, vol, sfxPitch(e));
}

stage.onBurst = (at) => {
  playSfx('blast', at);
  setTimeout(() => playSfx('twinkle', at), 450);
  if (ctrl.mode === 'watch') {
    ctrl.setMode('happy', 0.9);
    if (performance.now() - lastSpoke > 6000) say('firework');
  }
};

/** 唱片機在放歌：悅靈和夥伴飛到唱片機上方跳舞（原版悅靈聽到唱片機也會跳舞） */
let jukeDanceAt = 0;
function danceToJukebox(force = false): void {
  const box = stage.jukebox;
  if (!box || !music.playingDisc) return;
  const now = performance.now();
  if (!force && now - jukeDanceAt < 4000) return;
  jukeDanceAt = now;
  const top = box.position.clone().add(new THREE.Vector3(0, 0.95, 0));
  if (!ctrl.posed) ctrl.dance(top);
  friends.forEach((f, i) => f.ctrl.dance(top.clone().add(new THREE.Vector3(Math.cos(i * 2.1) * 0.7, 0.15 * i, Math.sin(i * 2.1) * 0.5))));
  stage.spawn('note', box.position.clone().add(new THREE.Vector3(0, 0.35, 0)), 1);
}

/** 從畫面點到的地面位置（限制在悅靈活動範圍內） */
function groundPoint(ray: THREE.Ray): THREE.Vector3 | null {
  const t = -ray.origin.y / ray.direction.y;
  if (!(t > 0)) return null;
  const p = ray.at(t, new THREE.Vector3());
  const b = stage.bounds();
  p.x = THREE.MathUtils.clamp(p.x, b.minX, b.maxX);
  p.z = THREE.MathUtils.clamp(p.z, b.minZ, b.maxZ);
  return p;
}

/** 飛到蛋糕旁邊：吃一片（原版每片 2 點飢餓度） */
let cakeWait = 0;
function atCake(): void {
  if (!stage.cake || feed(pet, 'cake') !== 'ok') {
    ctrl.setMode('happy', 0.9);
    cakeWait = 6;
    return;
  }
  const left = stage.biteCake();
  ctrl.eat();
  rememberFood(pet.memory, 'cake');
  say(left ? 'cakeBite' : 'cakeDone', 'cake', left);
  celebrate(['mFed']);
  cakeWait = 5;
}

/** 悅靈接住丟過來的東西 */
function caught(): void {
  const kind = stage.ball?.kind;
  stage.removeBall();
  if (!kind) return;
  playSfx('pickup', ctrl.pos);
  if (kind === 'slime') {
    playSfx('slime', ctrl.pos);
    play(pet);
    pet.memory.lastPlayAt = Date.now();
    say('play');
    celebrate(['mPlayed']);
    return;
  }
  // 食物：悅靈認得是什麼，接住後吃掉
  if (feed(pet, kind) === 'ok') {
    ctrl.eat();
    model.holdItem(stage.itemTexture(kind));
    setTimeout(() => model.holdItem(null), 1400);
    rememberFood(pet.memory, kind);
    say(FAVORITE_FOOD[pet.personality] === kind ? 'favorite' : 'fedFood', kind);
    celebrate(['mFed']);
  } else say('fullFood', kind);
}

const ctrl = new AllayController(
  model,
  { camera: stage.camera, bounds: () => stage.bounds(), night: () => night, bed: () => (stage.bed ? stage.bedSpot(new THREE.Vector3()) : null), bedYaw: () => stage.bedYaw() },
  pet,
  {
    say,
    particle: (kind, at, count, color, spread) => stage.spawn(kind, at, count, color, spread),
    caught,
    atCake,
    sfx: playSfx,
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
  // 夥伴不睡床（床只有一張，給主角）
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
  pet.memory.lastDanceAt = Date.now();
  if (!wasDancing && ctrl.dancing) say('dance');
}

const hud = new Hud(overlay, {
  select: (slot) => {
    if (slot === 'mic') void micOn();
    else micOff();
    if (slot === 'wave') void sensorOn();
    else sensorOff();
    if (slot !== 'note') stage.removeNoteBlock();
  },
  call: () => {
    playSfx('bell');
    ctrl.call();
  },
  sfx: playSfx,
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
  arOpen: () => void arOpen(),
  arClose: () => void arClose(),
  arPhoto: () => {
    if (!arCam.on) return;
    wantPhoto = true;
    playSfx('click');
  },
  arRecord: () => void arRecord(),
  replies: () => replies.map((r) => !!r),
  recordReply: async (i) => {
    sound.unlock();
    const ctx = sound.context;
    if (!ctx) return null;
    try {
      const rec = await recordClip(ctx);
      return {
        stop: rec.stop,
        done: rec.done.then(async (clip) => {
          if (!clip) return false;
          replies[i] = clip;
          await saveReplies(getLang(), replies);
          return true;
        }),
      };
    } catch {
      hud.toast(t('micDenied'));
      return null;
    }
  },
  playReply: (i) => {
    sound.unlock();
    const ctx = sound.context;
    const r = replies[i];
    if (ctx && r) sound.playClip(clipBuffer(ctx, r, voiceStyle));
  },
  deleteReply: (i) => {
    replies[i] = null;
    void saveReplies(getLang(), replies);
  },
  voiceStyle: () => voiceStyle,
  setVoiceStyle: (v) => {
    voiceStyle = v;
    saveVoiceStyle(localStorage, v);
  },
  arFlip: () => void arOpen(arCam.facing === 'user' ? 'environment' : 'user'),
  arPose: (p) => {
    if (p === 'turn') {
      ctrl.poseYaw += Math.PI / 4;
      return;
    }
    if (p === 'free') {
      ctrl.setPose(null);
      model.holdItem(null);
      return;
    }
    if (!ctrl.posed) hud.showItem(t('arPoseHint'));
    // 捧著：每按一次換一樣食物
    if (p === 'hold') {
      holdIndex = ctrl.posed === 'hold' ? (holdIndex + 1) % FOOD_IDS.length : holdIndex;
      model.holdItem(stage.itemTexture(FOOD_IDS[holdIndex]));
    } else model.holdItem(null);
    ctrl.setPose(p);
  },
  biome: () => biome,
  setBiome: (b) => {
    biome = b;
    saveBiome(localStorage, b);
    void applyBiome();
  },
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
  bgm: () => music.enabled,
  setBgm: (on) => {
    sound.unlock();
    music.setEnabled(on);
  },
  musicAvailable: () => music.available,
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
    visitDay(pet.memory);
    applyGlow();
    hud.setName(name);
    save();
    setTimeout(() => say('greet'), 600);
  },
  importAssets: async (file) => {
    // 0～5%：讀取；5～85%：存入這台裝置（依檔案大小計算）；85～100%：套用到遊戲
    hud.progress(t('packReading'), 0, 0.05);
    try {
      const p = await readPackFile(file);
      await savePack(p, (at, next) => hud.progress(t('packSaving'), 0.05 + at * 0.8, 0.05 + next * 0.8));
      localStorage.removeItem(OPT_OUT_KEY);
      hud.progress(t('packApplying'), 0.85, 0.99);
      await applyPack(p);
      hud.progressEnd(t('packDone', { v: p.source }), true);
    } catch (e) {
      hud.progressEnd(t('packFail', { e: (e as Error).message || String(e) }), false);
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

/** 用素材包裡的原版 ascii.png 當場做成英數字型（只存在這台裝置，網站不含原版字型） */
async function useAsciiFont(img: HTMLImageElement): Promise<void> {
  const c = document.createElement('canvas');
  c.width = c.height = img.width;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const ttf = buildFont('MC Ascii', asciiGlyphs(ctx.getImageData(0, 0, img.width, img.width).data, img.width));
  const face = new FontFace('MC Ascii', ttf.buffer as ArrayBuffer);
  await face.load();
  document.fonts.add(face);
}

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
  await applyBiome();
  stage.useImages(img);
  stage.useFoodImages(food);
  stage.useCakeImages(img);
  stage.useBedImages(img);
  stage.useJukeboxImages(img);
  music.usePack(p);
  stage.usePlayImages(img);
  hud.useImages(img);
  if (img.ascii) await useAsciiFont(img.ascii).catch(() => {});
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
  // 今天第一次見面：依時段問候，並看看有沒有連續見面、相處天數的紀念
  const firstToday = visitDay(pet.memory);
  save();
  setTimeout(() => {
    if (kind === 'missed' || kind === 'longAway') {
      ctrl.call();
      cheer(pet, kind === 'longAway' ? 30 : 20);
      if (kind === 'longAway') playSfx('levelup');
      stage.spawn('heart', ctrl.headTop(new THREE.Vector3()), kind === 'longAway' ? 6 : 3);
    } else if (kind === 'welcomeBack') cheer(pet, 10);
    if (kind === 'greet' && firstToday) say(timeGreeting());
    else say(kind);
    if (firstToday) celebrate(['mStreak', 'mDays']);
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
  music.pause(document.hidden);
  if (document.hidden) {
    if (listener.on) hud.setSelected(null);
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
  playSfx('throw');
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
  if (sel === 'jukebox') {
    // 點到唱片機：換下一張唱片（最後一張之後停止）；點地面：放下或搬過去
    const hitJuke = !!stage.jukebox && raycaster.intersectObject(stage.jukebox, false).length > 0;
    if (hitJuke) {
      sound.unlock();
      void music.nextDisc().then((title) => {
        hud.showItem(title ? t('nowPlaying', { t: title }) : t('musicStop'));
        if (title) danceToJukebox(true);
      });
      return;
    }
    const p = groundPoint(ray);
    if (!p) return;
    stage.placeJukebox(p);
    playSfx('wood', p);
    return;
  }
  if (sel === 'note') {
    // 跳舞中點悅靈 = 送紫水晶碎片；其他時候點哪裡都是放下 / 彈奏音符盒
    if (hit && ctrl.dancing) return giveShard();
    const hitBlock = !!stage.noteBlock && raycaster.intersectObject(stage.noteBlock, false).length > 0;
    return useNoteBlock(ray, hitBlock);
  }
  if (sel === 'food' && hud.food === 'cake') {
    // 蛋糕像原版一樣放在地上，悅靈肚子餓時會飛過去一片一片吃
    const p = groundPoint(ray);
    if (!p) return;
    stage.placeCake(p);
    playSfx('place', p);
    cakeWait = 0;
    return;
  }
  if (sel === 'food' && hud.food) {
    // 食物不蓄力，輕輕拋給悅靈接（無限使用）
    throwAt(hud.food, ray, 0);
    return;
  }
  if (sel === 'bed') {
    // 點到床：悅靈睡著就叫醒，醒著就去睡；點地面就把床放過去
    const hitBed = !!stage.bed && raycaster.intersectObject(stage.bed, true).length > 0;
    if (hitBed) {
      if (ctrl.mode === 'sleep') ctrl.wake();
      else ctrl.goBed();
      return;
    }
    const p = groundPoint(ray);
    if (!p) return;
    stage.placeBed(p);
    playSfx('wood', p);
    return;
  }
  if (sel === 'firework') {
    const p = groundPoint(ray);
    if (!p) return;
    stage.launchFirework(p);
    playSfx('launch', p);
    ctrl.watch(p.clone().add(new THREE.Vector3(0, 2.6, 0)));
    return;
  }
  if (sel === 'bath') {
    if (!hit) return hud.showItem(t('hint.bath'));
    const head = ctrl.headTop(new THREE.Vector3());
    stage.splash(head, 14);
    stage.bubbles(ctrl.pos, 10);
    playSfx('bucket', ctrl.pos);
    setTimeout(() => {
      playSfx('splash', ctrl.pos);
      stage.splash(ctrl.pos, 10);
    }, 500);
    ctrl.bathe();
    cheer(pet, 6);
    say('bath');
    return;
  }
  if (sel === 'feather') {
    if (!hit) return hud.showItem(t('featherMiss'));
    play(pet);
    ctrl.tickled();
    playSfx('tickle', ctrl.pos);
    say('tickle');
    return;
  }
  if (hit) {
    petPet(pet);
    if (ctrl.petted()) say('pet');
    celebrate(['mPetted']);
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
// AR 攝影棚：一指拖曳移動悅靈、兩指捏合縮放
const touches = new Map<number, { x: number; y: number }>();
let pinch: { dist: number; scale: number } | null = null;
let holdIndex = 0;
const posing = () => arCam.on && !!ctrl.posed;

function dragAllay(x: number, y: number): void {
  const ray = rayFrom(x, y);
  // 跟悅靈同一個深度的平面上
  const t = (ctrl.posePos.z - ray.origin.z) / ray.direction.z;
  if (!(t > 0)) return;
  const p = ray.at(t, new THREE.Vector3());
  const b = stage.bounds();
  ctrl.posePos.set(THREE.MathUtils.clamp(p.x, b.minX * 1.3, b.maxX * 1.3), THREE.MathUtils.clamp(p.y - 0.25, 0.2, b.maxY + 0.6), ctrl.posePos.z);
}

function pinchDist(): number {
  const [a, b] = [...touches.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
}

canvas.addEventListener('pointerdown', (e) => {
  if (posing()) {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) pinch = { dist: pinchDist(), scale: model.root.scale.x };
    else dragAllay(e.clientX, e.clientY);
    return;
  }
  down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0, rub: 0 };
  if (hud.selected === 'slime') chargeStart = performance.now();
});
canvas.addEventListener('pointermove', (e) => {
  if (posing() && touches.has(e.pointerId)) {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && touches.size === 2) model.root.scale.setScalar(THREE.MathUtils.clamp((pinch.scale * pinchDist()) / pinch.dist, 0.4, 3));
    else if (touches.size === 1) dragAllay(e.clientX, e.clientY);
    return;
  }
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
      celebrate(['mPetted']);
    }
  }
});
canvas.addEventListener('pointerup', (e) => {
  if (touches.delete(e.pointerId)) {
    if (touches.size < 2) pinch = null;
    return;
  }
  if (chargeStart !== null) {
    // 放開就丟，蓄力時手指移動也沒關係（以放開的位置決定方向）
    throwAt('slime', rayFrom(e.clientX, e.clientY), chargeLevel());
    chargeStart = null;
    hud.setCharge(null);
  } else if (down && down.moved < 14 && performance.now() - down.t < 600) tap(e.clientX, e.clientY);
  down = null;
});
canvas.addEventListener('pointercancel', (e) => {
  touches.delete(e.pointerId);
  pinch = null;
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
  // 天空顏色跟著生態域與日夜
  const [top, bottom] = BIOME_STYLE[biome][night ? 'night' : 'day'];
  sky.style.background = `linear-gradient(180deg, ${top} 0%, ${bottom} 75%)`;
}

// ---------- 生態域背景 ----------

let biome: Biome = loadBiome(localStorage);
let ambientIn = 20;

/** 換背景：從素材包讀這個生態域的材質（沒有素材包就用純色） */
async function applyBiome(): Promise<void> {
  const paths = biomeTextures(biome);
  const img = pack ? await loadImages(pack, Object.fromEntries(paths.map((p) => [p, p]))) : {};
  stage.setBiome(BIOME_STYLE[biome], img);
  updateSky();
}
void applyBiome();
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
  // AR：3D 畫面剛畫好時，跟相機畫面合成（拍照、錄影）
  if (arCam.on && (composer.recording || wantPhoto)) {
    composer.compose();
    if (wantPhoto) {
      wantPhoto = false;
      void composer.photo().then(async (b) => {
        if (b && (await saveMedia(b, mediaName('jpg'))) !== 'cancelled') hud.toast(t('arSaved'));
      });
    }
  }
  hud.setShardReady(ctrl.dancing);

  // 主動發言：每 15 秒檢查一次，距離上次發言超過 45 秒才說話
  if (ctrl.awake && pet.onboarded) {
    talkIn -= dt;
    if (talkIn <= 0) {
      talkIn = 15;
      if (now - lastSpoke > 45_000 && (ctrl.mode === 'idle' || ctrl.mode === 'approach' || ctrl.mode === 'wander')) {
        const mood = moodLevel(pet.mood);
        // 心情不差、也不餓不睏時，有時會聊起記得的事
        const topic = pet.hunger >= 6 && pet.energy >= 25 && mood > 0 && Math.random() < 0.35 ? memoryTopic(pet) : null;
        if (topic) say(topic.kind, topic.food, topic.d);
        else say(pet.hunger < 6 ? 'hungry' : pet.energy < 25 ? 'sleepy' : mood === 0 ? 'lonely' : night && Math.random() < 0.3 ? 'night' : mood === 2 && Math.random() < 0.5 ? 'happyIdle' : 'idle');
      }
    }
  }

  if (chargeStart !== null) hud.setCharge(chargeLevel());
  danceToJukebox();
  // 睡在床上時蓋被子
  stage.setBlanket(ctrl.lying);
  ctrl.hearing += (listener.level - ctrl.hearing) * Math.min(1, dt * 12);

  // 生態域的環境音（沼澤的青蛙、地獄的低鳴…），偶爾響一次
  const amb = BIOME_STYLE[biome].ambient;
  ambientIn -= dt;
  if (ambientIn <= 0) {
    ambientIn = amb ? amb.every[0] + Math.random() * (amb.every[1] - amb.every[0]) : 20;
    if (amb) sound.effect(amb.path, amb.vol, 0.9 + Math.random() * 0.2, (Math.random() - 0.5) * 1.2);
  }

  // 地上有蛋糕、肚子還沒飽：過一會兒就飛過去吃一片
  cakeWait -= dt;
  if (stage.cake && cakeWait <= 0 && pet.hunger < MAX_HUNGER - 0.5 && ['idle', 'wander', 'approach', 'observe', 'curious'].includes(ctrl.mode)) {
    cakeWait = 2;
    ctrl.seekCake(stage.cake.position);
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
