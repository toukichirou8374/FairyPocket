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
import { BABBLE_LEVEL, babbleF0, Sound } from './audio';
import { speakBabble } from './babble';
import { SFX, sfxPitch, type Sfx } from './sfx';
import { Music } from './music';
import { ArCamera, Composer, saveMedia, type ArEvents, type Facing } from './ar';
import { KeyGameUI } from './ui/keyGameUI';
import { StickerBook } from './ui/stickerBook';
import { MotionTracker } from './motion';
import { STICKERS, stickerCanvas } from './game/stickers';
import { buildCrown, buildDanceStage, DANCE_TEXTURES, type DanceImages } from './three/danceStage';
import { allVoiceEntries, clipBuffer, Listener, loadReplies, loadStickerClips, loadVoiceStyle, putVoiceEntries, recordClip, renameStickerClips, saveReplies, saveStickerClip, saveVoiceStyle, type Clip } from './voice';
import { collectLocal, packValue, parseExtras, restoreLocal, unpackValue } from './game/backup';
import { legacyRenames } from './game/sbItems';
import { detectIntent, refine, talkLine, type Intent } from './game/talk';
import { detectCommand } from './assist/command';
import { Assistant, type Mood } from './assist/assistant';
import { SenseTest } from './ui/senseTest';
import { VoiceAge, voiceAgeOn, type AgeGuess } from './voiceAge';
import { addPerson, identify, learn, loadPeople, MAX_PEOPLE, nameFrom, savePeople, voiceFeatures, voiceIdOn } from './voiceId';
import { voiceIdLine } from './assist/assistant';
import { addNote, ask, askCloud, buildSystem, dropMixedSentences, initBrain, mixedLanguage, loadBrain, saveBrain, loadMemory, parseReply, remember, saveMemory, type Feeling } from './brain/brain';
import { GESTURE_LABEL, gestureName, GESTURE_SEC } from './three/gestures';
import { DIRECT_EVENTS, intentName, isLifeSlot, lifeChatRules, lifeEventText, lifeRules, lifeTextVoiceOn, madeUp, PREFER, overheardText, addressedTo, parseLifeReply, retryDelay, type Intent as LifeIntentName, type LifeEvent, type LifeSlot } from './life/life';
import { fetchTts, listModels, look } from './brain/brain';
import { TREASURE_NAME, loadTreasures, saveTreasures, treasureCount, treasureList, type TreasureKind } from './life/rhythm';
import { HABITS, addLog, awayText, bumpLike, lastLifeSeen, loadLikes, loadLog, markLifeSeen, rhythmText, saveLikes, saveLog, todayLog, topLikes } from './life/rhythm';
import { monitorLog, monitorOn } from './life/monitor';
import { lifeSystem, nameTag, pickHeard } from './life/persona';
import { LOOK_EVERY, SAW_EVERY, SIGHT_FRESH, VISION_PROMPT, lifeVisionOn, parseVision, snapshot, type Sight } from './life/vision';
import { pickVoice, loadTtsVoices } from './ttsVoice';
import { Recognizer, speechSupported } from './speech';
import { neuralBuffer } from './neuralVoice';
import { BIOME_STYLE, biomeTextures, loadBiome, saveBiome, type Biome } from './three/biome';
import { memoryTopic, rememberFood, takeMilestone, timeGreeting, visitDay, type MilestoneLine } from './game/memory';
import { asciiGlyphs, buildFont } from './pixelFont';
import { getLang, itemName, loadLang, saveLang, setLang, t, type Lang } from './i18n';

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
const music = new Music(sound);
let lastSpoke = 0;
/** AI 生命模式（null＝沒有開）：開著時不說原生的固定台詞，發生的事交給 AI */
let lifeSlot: LifeSlot | null = null;
const say = (kind: LineKind, food?: Food | null, d: number | string = '') => {
  if (lifeSlot) return lifeFromLine(kind, food ?? null, d);
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

/** 跟悅靈說話：支援語音辨識時把話轉成文字、找關鍵字回答 */
const talkRec = new Recognizer();
let talkOn = false;
/** 悅靈說話時先不聽 */
let talkDeafUntil = 0;
/** 被叫「安靜一點」之後，這段時間只用小聲的方式回應 */
let quietUntil = 0;

// ---------- 說話者辨識・第一步：聽聲音高低猜大人或小朋友 ----------
const voiceAge = new VoiceAge();
/** 這台裝置上「語音辨識」和「另外聽音高」不能同時用時，就不再分辨 */
let ageBlocked = false;
let speaker: { guess: AgeGuess; at: number } = { guess: null, at: 0 };
/** 最近（3 分鐘內）說話的人像大人還是小朋友 */
function currentSpeaker(): AgeGuess {
  return performance.now() - speaker.at < 180_000 ? speaker.guess : null;
}

// ---------- 語言：只聽、只說設定中的語言 ----------
// 以前會「聽到別的語言就暫時換過去」，結果常常講中文卻回日文、換語言時重新啟動辨識也容易漏聽；
// 現在固定用設定的語言（要換語言請到設定改）。
/** 語音辨識用的語言 */
const recLang: Lang = getLang();

/** 聊天用的語言＝設定的語言 */
function talkLang(): Lang {
  return getLang();
}

async function micOn(): Promise<void> {
  sound.unlock();
  const ctx = sound.context;
  if (!ctx || listener.on || talkOn) return;
  if (speechSupported()) {
    talkOn = talkRec.start(
      SPEECH_LANG[recLang],
      (text, final, alts) => {
        if (performance.now() < talkDeafUntil) return;
        // 有人在說話：原本會飛過來歪頭聽（AI 生命模式由 AI 自己決定，不自動飛過來）
        if (!final) {
          if (!lifeSlot) ctrl.listen(true);
        } else void answerText(text, alts, true);
      },
      // 語音辨識不能用（沒有權限等）：改用只聽聲音的方式
      () => {
        talkRec.stop();
        talkOn = false;
        // 可能是跟「聽音高」搶麥克風：關掉分辨大人小孩再試一次
        if (voiceAge.on) {
          voiceAge.stop();
          ageBlocked = true;
          void micOn();
          return;
        }
        // AI 生命模式不用「只聽聲音、用悅靈語回」的原生方式：改用打字
        if (lifeSlot) return hud.showItem(t('life.noSpeech'));
        void micListen();
      },
    );
    if (talkOn) {
      if (voiceAgeOn() && !ageBlocked) void voiceAge.start(ctx);
      return;
    }
  }
  if (lifeSlot) return hud.showItem(t('life.noSpeech'));
  await micListen();
}

/** 聽懂了：照意思回答；聽不懂就用原本的方式（錄好的回應或悅靈語） */
/** 開發用：離線算出悅靈語的波形，回傳長度、最大音量、平均音量（調音量用） */
async function babbleStats(text: string, p: PetState['personality'] = pet.personality): Promise<{ sec: number; peak: number; rms: number }> {
  const rate = 24000;
  const ctx = new OfflineAudioContext(1, rate * 6, rate);
  const sec = speakBabble(ctx, ctx.destination, text, { f0: babbleF0(p), level: BABBLE_LEVEL }, 0.01);
  const d = (await ctx.startRendering()).getChannelData(0).subarray(0, Math.ceil(rate * (sec + 0.05)));
  let peak = 0;
  let sum = 0;
  for (const v of d) {
    peak = Math.max(peak, Math.abs(v));
    sum += v * v;
  }
  return { sec, peak, rms: Math.sqrt(sum / d.length) };
}

// ---------- 運動場（第一次打開時才下載程式） ----------
let sportsField: import('./sports/sports').SportsField | null = null;
async function openSports(): Promise<void> {
  if (!sportsField) {
    const { SportsField } = await import('./sports/sports');
    sportsField = new SportsField({
      root: overlay,
      scene: stage.scene,
      ballTexture: () => stage.itemTexture('slime'),
      lang: getLang,
      personality: () => pet.personality,
      begin: () => {
        sound.unlock();
        // 先離開說話模式（泡泡才會顯示在悅靈頭上），收起場地上的方塊、床等道具
        hud.setSelected(null);
        ctrl.setPose('fly');
        for (const o of [stage.noteBlock, stage.cake, stage.bed, stage.jukebox]) if (o) o.visible = false;
      },
      end: () => {
        for (const o of [stage.noteBlock, stage.cake, stage.bed, stage.jukebox]) if (o) o.visible = true;
        ctrl.setPose(null);
      },
      allayTo: (x, y, z) => ctrl.posePos.set(x, y, z),
      react: (m, d) => ctrl.perform(m, d),
      allayHead: () => ctrl.headTop(new THREE.Vector3()),
      spawn: (k, at, n) => stage.spawn(k, at, n),
      say: (text) => hud.say(text),
      chirp: () => sound.speak(pet.personality),
      sfx: (e) => playSfx(e),
      click: () => playSfx('click'),
    });
  }
  sportsField.open();
}

/** 最後一次有人跟悅靈說話的時間（剛聊完不主動閒聊） */
let lastUserAt = -Infinity;

async function answerText(text: string, alts: string[] = [text], fromMic = false): Promise<void> {
  lastUserAt = performance.now();
  // AI 生命模式：不用規則（指令、認人問名字、關鍵字），全部交給 AI
  if (lifeSlot) {
    if (!text.trim()) return;
    liveWake();
    // 聽聲音認人（只在這台手機比對）：認得就叫名字，不認得就不稱呼（不再叫「主人」）
    if (fromMic) {
      const family = people.map((p) => p.name);
      text = pickHeard([text, ...alts.filter((a) => a !== text)], family);
      const heard = voiceAge.on ? voiceAge.takeRecent() : null;
      const feat = heard ? voiceFeatures(heard.data, heard.rate) : null;
      if (feat && voiceIdOn()) {
        lastVoice = { feat, at: performance.now() };
        const { person } = identify(people, feat);
        if (person) {
          learn(person, feat);
          savePeople(people);
          currentPerson = { name: person.name, at: performance.now() };
        } else currentPerson = null;
      }
    }
    assistant.chat(personNow() ?? t('chat.you'), text);
    // 第四階段：麥克風聽到的話不一定是對她說的（家人互相說話、電視）。
    // 叫了她的名字、或她剛說完話（在回她）才算對她說；其他的交給 AI 判斷要不要回（多半安靜）
    const sinceSpoke = (performance.now() - lastSpoke) / 1000;
    const toHer = !fromMic || addressedTo(text, pet.name, sinceSpoke);
    monitorLog('heard', { text, typed: !fromMic, toHer, sinceSpokeSec: Math.round(sinceSpoke) });
    if (!toHer) {
      void lifeAsk(overheardText(who(text), talkLang()), 'event');
      return;
    }
    // 主人打字或叫她：她正在說的話先停下來（被打斷），轉過來看著主人
    if (!fromMic) lifeHush();
    ctrl.attend(10);
    void lifeAsk(who(text), 'chat');
    return;
  }
  ctrl.listen(false);
  liveWake();
  // 語言固定為設定的語言（不再因為聽到或被要求別的語言而切換）
  const lang = talkLang();
  const tries = alts.length ? alts : [text];
  // 聽聲音高低猜是大人還是小朋友（AI 大腦會依照這個調整說話方式）
  if (voiceAge.on) {
    const g = voiceAge.guess().guess;
    if (g) speaker = { guess: g, at: performance.now() };
  }
  // 認人：聽聲音大概猜是誰；第一次聽到的聲音會問名字
  const heard = voiceAge.on ? voiceAge.takeRecent() : null;
  const feat = heard ? voiceFeatures(heard.data, heard.rate) : null;
  assistant.chat(personNow() ?? t('chat.you'), text);
  if (voiceIdStep(text, feat)) return;
  // 要悅靈幫忙做的事（天氣、時間、計時、音樂、查資料）：每個可能聽成的說法都試試看
  for (const a of tries) {
    const cmd = detectCommand(a, lang);
    if (cmd) {
      void assistant.run(cmd);
      return;
    }
  }
  // AI 優先：AI 可以用的時候，所有的話都先交給 AI 判斷意思與動作
  // （AI 互動模式：雲端 AI → 本機 AI；互動模式：本機 AI），AI 不能用或失敗時才用關鍵字規則
  if (text.trim() && brainReady() && (await brainAnswer(text))) return;
  let intent: Intent | null = null;
  for (const a of tries) if ((intent = detectIntent(a, lang))) break;
  if (!intent) {
    if (!text.trim()) return;
    await answer(new Float32Array(Math.round(text.length * 2400)), 24000, true);
    return;
  }
  remember(brainMem, 'user', who(text));
  reactTo(intent);
}

// ---------- 說話者辨識・第二步：模糊認人（第一次聽到的聲音在對話裡問名字） ----------
const people = loadPeople();
/** 最近聽到的一段聲音特徵（生命模式裡有人說出名字時，記成那個人） */
let lastVoice: { feat: number[]; at: number } | null = null;
/** 問了名字、等對方自我介紹 */
let askName: { feat: number[]; at: number } | null = null;
let lastAskAt = -Infinity;
let secretUntil = 0;
/** 最近說話的人（聽聲音猜的） */
let currentPerson: { name: string; at: number } | null = null;

function personNow(): string | null {
  return currentPerson && performance.now() - currentPerson.at < 180_000 ? currentPerson.name : null;
}
/** 記到對話裡時，前面加上是誰說的 */
function who(text: string): string {
  const n = personNow();
  return n ? `${n}：${text}` : text;
}

/** 回傳 true = 這句話已經處理（問名字、記住名字），不用再回答 */
function voiceIdStep(text: string, feat: number[] | null): boolean {
  const now = performance.now();
  const lang = talkLang();
  if (askName && now - askName.at < 40_000) {
    const ask = askName;
    askName = null;
    if (/不要|不用|不告訴|秘密|祕密|いや|ひみつ|秘密|no thanks|secret|not telling/i.test(text)) {
      secretUntil = now + 15 * 60_000;
      assistSay(voiceIdLine(lang, 'vidSecret'), 'shy');
      return true;
    }
    const name = nameFrom(text);
    if (name) {
      // 問名字前後兩句的聲音一起記，比較準
      const f = feat ? ask.feat.map((v, i) => (v + feat[i]) / 2) : ask.feat;
      addPerson(people, name, f);
      savePeople(people);
      currentPerson = { name, at: now };
      remember(brainMem, 'allay', voiceIdLine(lang, 'vidRemember', name));
      saveMemory(brainMem);
      assistSay(voiceIdLine(lang, 'vidRemember', name), 'happy');
      stage.spawn('heart', ctrl.headTop(new THREE.Vector3()), 4);
      return true;
    }
    // 不是在說名字：當成一般的話照常回答
  }
  if (!feat || !voiceIdOn()) return false;
  const { person } = identify(people, feat);
  if (person) {
    learn(person, feat);
    savePeople(people);
    currentPerson = { name: person.name, at: now };
    return false;
  }
  // 還不認識的聲音：問名字（別太常問）
  if (people.length >= MAX_PEOPLE || now < secretUntil || now - lastAskAt < 3 * 60_000) return false;
  lastAskAt = now;
  askName = { feat, at: now };
  currentPerson = null;
  assistSay(voiceIdLine(lang, 'vidWho'), 'surprised');
  return true;
}

// ---------- AI 大腦（家裡電腦的本機 AI） ----------
const brainMem = loadMemory();
// AI 大腦的連線設定是加密存的：啟動時解密一次
void initBrain();
/** AI 模式（快捷欄的 AI 文字／語音／動態）：第三層的雲端 AI 之後接在這裡 */
let cloudMode = false;
let brainBusy = false;

const FEELING_MOOD: Record<Exclude<Feeling, null>, Mood> = { happy: 'happy', sad: 'sad', surprised: 'surprised', shy: 'shy', sleepy: 'sleepy' };

/** 雲端 AI 不能用時告訴主人一次（同一種原因 10 分鐘內不重複） */
const cloudNoticeAt: Record<string, number> = {};
function cloudNotice(why: 'budget' | 'nokey' | 'denied' | 'refusal' | 'net'): void {
  if (why === 'refusal' || why === 'net') return;
  const now = performance.now();
  if (now - (cloudNoticeAt[why] ?? -Infinity) < 600_000) return;
  cloudNoticeAt[why] = now;
  hud.toast(t(`cloud.${why}`));
}

// ---------- 雲端 AI 額度用完：悅靈會喊累、露出疲倦的樣子，讓主人知道 ----------
const TIRED_KEY = 'fairypocket.cloudtired.v1';
/** 額度用完的狀態：until＝額度恢復的時間（隔天 0 點／下個月 1 號），check＝下次再試雲端的時間 */
let cloudTired: { scope: 'day' | 'month'; until: number; check: number } | null = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(TIRED_KEY) ?? 'null') as typeof cloudTired;
    return v && v.until > Date.now() ? v : null;
  } catch {
    return null;
  }
})();
function setCloudTired(scope: 'day' | 'month' | null): void {
  if (!scope) cloudTired = null;
  else {
    const d = new Date();
    const until = scope === 'month' ? new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() : new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    // 30 分鐘後再試一次（主人可能在電腦上調高了上限）
    cloudTired = { scope, until, check: Date.now() + 30 * 60_000 };
  }
  try {
    if (cloudTired) localStorage.setItem(TIRED_KEY, JSON.stringify(cloudTired));
    else localStorage.removeItem(TIRED_KEY);
  } catch {
    /* 存不了也沒關係 */
  }
}
function isCloudTired(): boolean {
  if (cloudTired && cloudTired.until <= Date.now()) setCloudTired(null);
  return !!cloudTired;
}
const TIRED_LINES: Record<'day' | 'month', Record<Lang, string[]>> = {
  day: {
    zh_tw: ['呼啊…今天動腦動太多，雲端的魔力用完了，好累喔…', '好睏…今天的雲端魔力用光了，明天再幫你想更厲害的答案', '哈啊～腦袋轉不動了…今天的雲端魔力沒了'],
    ja_jp: ['ふわぁ…きょうはいっぱい考えたから、クラウドのまりょくがなくなっちゃった…つかれた…', 'ねむい…きょうのクラウドのまりょくはおしまい。またあしたね', 'あたまがまわらないよ…きょうのまりょく、つかいきっちゃった'],
    en_us: ["Yawn… I thought so hard today that my cloud magic ran out… so tired…", "So sleepy… today's cloud magic is used up. More clever answers tomorrow!", "My head is spinning… no more cloud magic today"],
  },
  month: {
    zh_tw: ['呼…這個月的雲端魔力全部用完了，好累好累…下個月再幫你喔', '累癱了…這個月的雲端魔力見底了，先用家裡的小腦袋陪你'],
    ja_jp: ['ふぅ…こんげつのクラウドのまりょく、ぜんぶつかっちゃった…へとへと…らいげつまたね', 'くたくた…こんげつのまりょくはもうないよ。いえのあたまでおはなしするね'],
    en_us: ["Phew… all of this month's cloud magic is gone… I'm exhausted… see you next month", "Worn out… this month's cloud magic is empty. I'll use my little home brain for now"],
  },
};
/** 疲倦的樣子：慢慢拍翅膀、閉眼、冒 zzz */
function tiredLook(): void {
  ctrl.setMode('rest', 6);
  stage.spawn('zzz', ctrl.headTop(new THREE.Vector3()), 3);
  window.setTimeout(() => stage.spawn('zzz', ctrl.headTop(new THREE.Vector3()), 2), 2200);
}

/** 家裡電腦的 AI 有設定、現在沒在想別的事 */
function brainReady(): boolean {
  const cfg = loadBrain();
  return cfg.on && !!cfg.url && !brainBusy;
}

interface BrainOpts {
  /** 不是主人說的話，而是發生的事（例如「主人對你揮手」）：記在對話裡時用括號 */
  event?: boolean;
  /** 一般模式的自主行動：只用家裡電腦的 AI（不用雲端額度）、不顯示「想一想」、可以只做動作不說話 */
  autonomous?: boolean;
}

/**
 * 問 AI 怎麼回應（AI 優先）：AI 互動模式＝雲端 AI → 本機 AI；互動模式與一般模式＝本機 AI。
 * AI 回答的動作標籤（[動作：舉右手]…）由悅靈的手、頭、翅膀、身體做出來，也會記在對話裡（AI 記得自己做過什麼）。
 * 回傳 false＝AI 沒有回答（呼叫的地方改用規則）。
 */
async function brainAnswer(text: string, opts: BrainOpts = {}): Promise<boolean> {
  const cfg = loadBrain();
  if (!cfg.on || !cfg.url || brainBusy) return false;
  brainBusy = true;
  // 想一想的樣子（自主行動時不顯示）
  if (!opts.autonomous) {
    ctrl.setMode('curious', 8);
    hud.say('…', 9000);
    listener.pausedUntil = talkDeafUntil = performance.now() + 9000;
  }
  const lang = talkLang();
  const system = buildSystem(pet, brainMem, lang, { hour: new Date().getHours(), asleep: pet.asleep, foodName: (f) => itemName(f), speaker: currentSpeaker(), person: personNow() });
  // AI 模式（第三層）：先問雲端 AI；不能用（沒金鑰、額度用完、不是本人、連不上）就退回家裡電腦的 AI
  // 額度用完了：不再去問雲端（每 30 分鐘再試一次）
  let useCloud = !opts.autonomous && cloudMode && (!isCloudTired() || Date.now() >= (cloudTired?.check ?? 0));
  let justTired = null as 'day' | 'month' | null;
  const once = async (): Promise<string | null> => {
    if (useCloud) {
      const c = await askCloud(cfg, system, brainMem, text, lang);
      if (c.ok) {
        if (cloudTired) setCloudTired(null);
        return c.text;
      }
      useCloud = false;
      if (c.why === 'budget') {
        if (!cloudTired) justTired = c.scope ?? 'day';
        setCloudTired(c.scope ?? 'day');
      }
      cloudNotice(c.why);
    }
    return ask(cfg, system, brainMem, text, 25000, lang);
  };
  let raw = await once();
  let r = raw ? parseReply(raw, lang) : null;
  // 用日文（或英文）聊天時混進了中文：再請 AI 回答一次；還是混的話，把混到的句子拿掉
  if (r?.text && mixedLanguage(r.text, lang)) {
    raw = await once();
    const again = raw ? parseReply(raw, lang) : null;
    if (again?.text) r = again;
    if (mixedLanguage(r.text, lang)) r = { ...r, text: dropMixedSentences(r.text, lang) };
  }
  brainBusy = false;
  // 自主行動可以只做動作不說話；一般對話一定要有回答
  if (!r || (!r.text && !(opts.autonomous && r.actions.length))) {
    if (!opts.autonomous) {
      listener.pausedUntil = voiceAge.pausedUntil = talkDeafUntil = 0;
      hud.say('', 1);
    }
    return false;
  }
  // 自主行動的提示不記進對話（只記悅靈自己做了什麼）；事件用括號記
  if (!opts.autonomous) remember(brainMem, 'user', opts.event ? text : who(text));
  const did = r.actions.length ? `（${GESTURE_LABEL[lang]}：${r.actions.map((g) => gestureName(g, lang)).join('、')}）` : '';
  remember(brainMem, 'allay', `${r.text}${did}`.trim());
  for (const n of r.notes) addNote(brainMem, n);
  saveMemory(brainMem);
  if (!r.text) {
    // 只做動作
    ctrl.gesture(r.actions);
    return true;
  }
  const tired = cloudMode && isCloudTired();
  if (justTired) {
    // 剛用完額度：先喊累，再用家裡電腦的 AI 回答
    const lines = TIRED_LINES[justTired][lang];
    const line = lines[Math.floor(Math.random() * lines.length)];
    assistSay(line, 'sleepy');
    tiredLook();
    const answer = r.text;
    window.setTimeout(() => {
      assistSay(answer, 'sleepy');
      tiredLook();
    }, Math.max(3600, line.length * (lang === 'en_us' ? 70 : 230)));
  } else {
    assistSay(r.text, tired ? 'sleepy' : r.feeling ? FEELING_MOOD[r.feeling] : 'happy');
    // AI 說的心情也表現在之後一陣子的動作和外觀上
    if (r.feeling) ctrl.setFeeling(tired ? 'sleepy' : r.feeling);
    if (tired) tiredLook();
    // AI 選的動作接在說話的同時做（蓋過心情預設的動作）
    else if (r.actions.length) ctrl.gesture(r.actions);
  }
  return true;
}

/** 最近說過的意思（一分鐘內一直說同一句，悅靈會發現） */
const heardRecently: { intent: Intent; at: number }[] = [];

/** 照聽到的意思做出反應（看情境、個性選台詞） */
function reactTo(intent: Intent): void {
  const now = performance.now();
  while (heardRecently.length && now - heardRecently[0].at > 60_000) heardRecently.shift();
  heardRecently.push({ intent, at: now });
  const reply = refine(intent, {
    hour: new Date().getHours(),
    hungry: pet.hunger < MAX_HUNGER * 0.3,
    sleepy: pet.asleep || night || pet.energy < 20,
    repeat: heardRecently.filter((x) => x.intent === intent).length,
    affection: pet.affection,
  });
  const line = talkLine(reply, talkLang(), pet.name, pet.personality);
  // 規則回答的也記下來，AI 才知道剛剛聊了什麼
  remember(brainMem, 'allay', line);
  saveMemory(brainMem);
  const head = ctrl.headTop(new THREE.Vector3());
  if (intent === 'quiet') quietUntil = now + 60_000;
  if (intent === 'tooQuiet' || intent === 'greet' || intent === 'morning' || intent === 'play' || intent === 'sing' || intent === 'home') quietUntil = 0;
  const quiet = now < quietUntil;
  hud.say(line);
  if (!quiet) void speakText(line, talkLang());
  else sound.speak(pet.personality);
  // 說話的時間大概抓一下，這段時間先不聽
  const len = quiet ? 1 : Math.min(6, 0.8 + line.length * (talkLang() === 'en_us' ? 0.07 : 0.2));
  talkDeafUntil = now + len * 1000 + 500;
  listener.pausedUntil = voiceAge.pausedUntil = talkDeafUntil;
  switch (reply) {
    case 'love':
    case 'lovesBack':
    case 'praise':
    case 'thanks':
    case 'sorry':
    case 'friend':
    case 'whoAmI':
      ctrl.setMode('happy', 2.5);
      stage.spawn('heart', head, 4);
      cheer(pet, 4);
      break;
    case 'tooQuiet':
    case 'dance':
    case 'sing':
    case 'play':
    case 'fly':
    case 'cheer':
    case 'happy':
    case 'joke':
      ctrl.setMode('flip', 1.6);
      stage.spawn('note', head, 4);
      cheer(pet, 3);
      break;
    case 'birthday':
    case 'proud':
      ctrl.setMode('flip', 1.6);
      stage.spawn('heart', head, 3);
      stage.spawn('note', head, 3);
      cheer(pet, 4);
      break;
    case 'greet':
    case 'morning':
    case 'bye':
    case 'home':
    case 'goOut':
      ctrl.waveBack();
      stage.spawn('note', head, 2);
      cheer(pet, 2);
      break;
    case 'quiet':
    case 'night':
    case 'sleepyNoPlay':
    case 'story':
      ctrl.setMode('rest', 5);
      break;
    case 'notCute':
    case 'mean':
    case 'repeat':
    case 'morningAtNight':
    case 'nightAtDay':
    case 'hungryNoPlay':
      ctrl.setMode('oops', 1.6);
      break;
    case 'sad':
    case 'scared':
    case 'hurt':
    case 'sick':
    case 'cold':
    case 'angry':
    case 'come':
    case 'where':
      ctrl.setMode('approach', 3);
      stage.spawn('heart', head, 2);
      break;
    default:
      ctrl.setMode('happy', 2);
      stage.spawn('note', head, 2);
  }
  lastSpoke = now;
}

async function micListen(): Promise<void> {
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
    // 麥克風不能用：還是可以用打字跟悅靈說話，所以不取消選取
    hud.showItem(t('micDenied'));
  }
}

function micOff(): void {
  talkRec.stop();
  talkOn = false;
  voiceAge.stop();
  listener.stop();
  ctrl.listen(false);
}

/** 說完了：從這個語言錄好的回應隨機挑一句；沒有就用悅靈語回答 */
async function answer(samples: Float32Array, rate: number, fromText = false): Promise<void> {
  ctrl.listen(false);
  // 被叫安靜的時候：只輕輕叫一聲
  if (performance.now() < quietUntil) {
    sound.speak(pet.personality);
    hud.say('…♪');
    listener.pausedUntil = voiceAge.pausedUntil = talkDeafUntil = performance.now() + 1200;
    return;
  }
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
  listener.pausedUntil = voiceAge.pausedUntil = talkDeafUntil = performance.now() + (len + 0.4) * 1000;
  void fromText;
  stage.spawn('note', ctrl.headTop(new THREE.Vector3()), 2);
  cheer(pet, 3);
  lastSpoke = performance.now();
}

// ---------- 相機 AR 模式（拍照、錄影、前鏡頭揮手） ----------

let lastGlance = 0;

// ---------- 動態模式：前鏡頭看到人、眼睛跟著人、揮手回應、可以說話 ----------
let liveOn = false;
/** 最後一次看到人在動的時間 */
let lastPersonAt = 0;
let lastLiveGreet = 0;
let personX = 0;
let personY = 0;

/** 鏡頭前的人在 3D 世界裡大概的位置（畫面前方、依左右上下偏移） */
function personPoint(): THREE.Vector3 {
  const cam = stage.camera;
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
  return cam.position.clone().addScaledVector(right, personX * 1.6).addScaledVector(up, personY * 0.9);
}

function liveMotion(x: number, y: number): void {
  const now = performance.now();
  personX += (x - personX) * 0.35;
  personY += (y - personY) * 0.35;
  // 好一陣子沒看到人，現在有人出現：打招呼。
  // 鏡頭只看得到「動」：人坐著不動也會被當成不在，所以 AI 生命模式要 3 分鐘沒動靜才算，而且 5 分鐘內只說一次
  const away = lifeSlot ? 600_000 : 30_000;
  const again = lifeSlot ? 1_200_000 : 60_000;
  if (now - lastPersonAt > away && now - lastLiveGreet > again && ctrl.awake && pet.onboarded) {
    lastLiveGreet = now;
    // AI 生命模式：只告訴 AI 有人出現了，要不要打招呼由 AI 決定
    if (lifeSlot) {
      lifeEvent('appear');
      lastPersonAt = now;
      return;
    }
    // AI 優先：讓 AI 決定怎麼打招呼（說什麼、做什麼動作）；AI 不能用才用固定的招呼
    void aiEvent('appear').then((ok) => ok || reactTo('greet'));
  }
  lastPersonAt = now;
}

/** 鏡頭看到的事交給 AI 判斷要怎麼反應（說話、動作或兩者） */
const EVENT_TEXT: Record<'wave' | 'appear', Record<Lang, string>> = {
  wave: {
    zh_tw: '（主人在鏡頭前對你揮手）',
    ja_jp: '（主人がカメラの前であなたに手を振っている）',
    en_us: '(Your friend is waving at you in front of the camera)',
  },
  appear: {
    zh_tw: '（好一陣子沒看到主人，現在主人出現在鏡頭前了）',
    ja_jp: '（しばらく見えなかった主人が、いまカメラの前にあらわれた）',
    en_us: '(Your friend just showed up in front of the camera after a while)',
  },
};
async function aiEvent(kind: keyof typeof EVENT_TEXT): Promise<boolean> {
  if (!brainReady()) return false;
  return brainAnswer(EVENT_TEXT[kind][talkLang()], { event: true });
}
// ---------- 一般模式的自主行動（本機 AI ＞ 腳本）----------
// 有網路、家裡電腦的 AI 可以用時，每 1～2 分鐘讓 AI 依個性、心情、時間和剛剛的事自己決定做什麼（多半只做動作）；
// AI 不能用時照舊由腳本（allayController.decide）決定。只用本機 AI（不用雲端額度）。
/** 快捷欄目前選的工具（null＝一般模式） */
let currentSlot: string | null = null;
const AUTO_TEXT: Record<Lang, string> = {
  zh_tw: '（現在沒有人跟你說話，你在手機裡自由活動。依照你的個性、心情、現在的時間和剛才的事，自己決定做一個動作；大多時候只做動作、不說話，要說話的話只說一句很短的自言自語。不要每次都做一樣的動作。）',
  ja_jp: '（いまはだれも話しかけていないので、スマホの中で自由にすごしています。性格、気分、時間、さっきのことから、自分でひとつ動作を決めてください。たいていは動作だけで話さず、話すならみじかいひとりごとをひとことだけ。毎回同じ動作はしないで。）',
  en_us: "(Nobody is talking to you; you are playing freely inside the phone. Based on your personality, mood, the time and what just happened, choose one action yourself. Usually just act without talking; if you talk, say only one very short line to yourself. Don't repeat the same action every time.)",
};
const AUTO_MODES = new Set(['idle', 'wander', 'observe', 'approach', 'flourish']);
let nextAutoAt = performance.now() + 45_000;
window.setInterval(() => {
  const now = performance.now();
  if (now < nextAutoAt) return;
  nextAutoAt = now + 60_000 + Math.random() * 60_000;
  if (document.visibilityState !== 'visible' || !navigator.onLine) return;
  // 只在一般模式：沒有選工具、沒有開相機、沒有固定姿勢（運動場）、沒有打開設定或其他畫面
  if (currentSlot !== null || arCam.on || ctrl.posed || ctrl.gesturing || !pet.onboarded || pet.asleep || !ctrl.awake) return;
  if (document.querySelector('.modal-back, .sb-panel, .kg-top')) return;
  if (now - lastUserAt < 20_000 || now - lastSpoke < 15_000 || !AUTO_MODES.has(ctrl.mode)) return;
  if (!brainReady()) return;
  void brainAnswer(AUTO_TEXT[talkLang()], { autonomous: true });
}, 5000);

// ---------- AI 生命模式（AI 文字生命／AI 語音生命／AI 動態生命）----------
// 只有「AI＋精靈控制器」：發生的事、主人說的話都交給 AI，AI 決定意圖、動作、要不要說話，
// 控制器負責飛過去、做出來、留在畫面內。AI 連不上時悅靈安全地待著（不改用原生台詞），恢復後接著生活。
// 主人說的話：雲端 AI（只有主人本人）→ 家裡電腦的 AI；自己決定要做什麼：只用家裡電腦的 AI（不花雲端額度）。
let lifeBusy = false;
/** 換模式時 +1：舊的 AI 回答回來時已經不是同一段生命模式，直接丟掉（不會搶控制權） */
let lifeEpoch = 0;
let lifeFails = 0;
let lifeNextAt = 0;
let lifeLastAsk = 0;
let lifeStandby = false;
let lifeStandbyToastAt = -Infinity;
const lifeRecent: LifeIntentName[] = [];
let lifePending: string[] = [];
let lifePendingDirect = false;
let lifeFlushTimer = 0;
/** 上次自己開口（不是回應主人）的時間：真實的人不會一直自言自語 */
let lifeSelfTalkAt = -Infinity;
/** 自己決定下一步時最少隔幾分鐘才說一句；看到、聽到什麼（不是主人直接互動）最少隔 1 分鐘 */
const SELF_TALK_GAP = { decide: 8 * 60_000, notice: 60_000 };

/** 畫面裡真的有的東西（給 AI 看，避免她說看到花、要去吃不存在的東西） */
function lifeScene(lang: Lang): string[] {
  const N: Record<string, [string, string, string]> = {
    grass: ['草地', 'くさはら', 'grass'],
    sky: ['天空', '空', 'sky'],
    stars: ['星空', '星空', 'starry sky'],
    bed: ['你的床', 'あなたのベッド', 'your bed'],
    cake: ['蛋糕', 'ケーキ', 'cake'],
    note: ['音符盒', '音ブロック', 'note block'],
    jukebox: ['唱片機', 'ジュークボックス', 'jukebox'],
    ball: ['家人丟的球', 'かぞくがなげたボール', 'the ball someone threw'],
  };
  const i = lang === 'zh_tw' ? 0 : lang === 'ja_jp' ? 1 : 2;
  const keys = ['grass', night ? 'stars' : 'sky', ...(stage.bed ? ['bed'] : []), ...(stage.cake ? ['cake'] : []), ...(stage.noteBlock ? ['note'] : []), ...(stage.jukebox ? ['jukebox'] : []), ...(stage.ball ? ['ball'] : [])];
  return keys.map((k) => N[k][i]);
}
/** 今天真的發生過的事、喜好（第二階段，存在手機裡） */
const lifeLog = loadLog();
const lifeLikes = loadLikes();
/** 記到「今天發生的事」的事件（作息、自己決定的不記） */
const LOGGED_EVENTS = new Set<LifeEvent>(['petted', 'tickled', 'woken', 'called', 'fed', 'favoriteFood', 'full', 'caughtBall', 'bath', 'noteBlock', 'bedTap', 'firework', 'cake', 'friend', 'wave', 'saw', 'found', 'milestone', 'renamed']);
/** 收藏（在地上找東西時偶爾真的找到） */
const lifeTreasures = loadTreasures();
let lifeFoundAt = -Infinity;
/** 在地上找完一個地方：大約 5 次找到 1 次，而且 4 分鐘內最多一次（找到的東西真的存下來） */
function lifeSearched(at: THREE.Vector3): void {
  if (!lifeSlot || performance.now() - lifeFoundAt < 240_000 || Math.random() > 0.2) return;
  lifeFoundAt = performance.now();
  const kinds: TreasureKind[] = ['shard', 'feather', 'bead'];
  const k = kinds[Math.floor(Math.random() * kinds.length)];
  lifeTreasures[k] = (lifeTreasures[k] ?? 0) + 1;
  saveTreasures(lifeTreasures);
  stage.spawn('sparkle', at.clone(), 6);
  ctrl.setFeeling('happy', 6);
  lifeEvent('found', TREASURE_NAME[k][talkLang()]);
}
const SAID_LOG: Record<Lang, (t: string) => string> = {
  zh_tw: (t) => `有人跟你說「${t}」`,
  ja_jp: (t) => `だれかが「${t}」と言った`,
  en_us: (t) => `Your friend said "${t}"`,
};

/** 回答用錯語言時，重問一次附上的提醒 */
/** 直接跟她說話時的提醒：回一句自然的短話（不用問句），也可以繼續做自己的事 */
const LIFE_CHAT_NUDGE: Record<Lang, string> = {
  zh_tw: '→ 這句是家人在跟你說話：像平常聊天一樣回一句短短的話，不用問問題；要繼續做你的事也可以。',
  ja_jp: '→ これはかぞくがあなたに話しかけたことば：ふだんの会話みたいにみじかく一言返して。質問しなくていい。自分のことを続けてもいい。',
  en_us: "→ A family member is talking to you: reply with one short, natural line like everyday talk; no need to ask a question. You can keep doing your thing.",
};
const LIFE_LANG_REMIND: Record<Lang, string> = {
  zh_tw: '（請只用台灣的繁體中文回答，不要用日文或英文。）',
  ja_jp: '（日本語だけで答えてください。中国語や英語はつかわないで。）',
  en_us: '(Please answer only in English, no Chinese or Japanese.)',
};

/** 原本的說話方式（選了這些就離開生命模式） */
const SENSE_TOOLS = new Set<string>(['text', 'mic', 'live', 'aitext', 'aimic', 'ailive']);

/** 這台裝置能不能用 AI 生命模式（選單顯示用；真正的權限是家裡電腦的通行碼與 Tailscale） */
function lifeAllowed(): boolean {
  const cfg = loadBrain();
  return cfg.on && !!cfg.url;
}

/** 原生台詞的情境 → 交給 AI 的事（沒有對應的就不說，例如閒聊、想睡，那些由 AI 自己決定） */
function lifeFromLine(kind: LineKind, food: Food | null, d: number | string): void {
  const name = food ? itemName(food) : '';
  const map: Partial<Record<string, LifeEvent>> = {
    pet: 'petted', tickle: 'tickled', wake: 'woken', fedFood: 'fed', favorite: 'favoriteFood', fullFood: 'full',
    play: 'caughtBall', bath: 'bath', cakeBite: 'cake', cakeDone: 'cake', duplicate: 'friend', firework: 'firework',
  };
  const e = map[kind] ?? (kind.startsWith('m') && /^m[A-Z]/.test(kind) ? 'milestone' : null);
  if (e) lifeEvent(e, e === 'milestone' ? String(d) : name);
}

/** 發生的事先收集一下（1.2 秒內的合成一次），再一起交給 AI */
function lifeEvent(e: LifeEvent, d = ''): void {
  if (!lifeSlot) return;
  const text = lifeEventText(e, talkLang(), d);
  monitorLog('event', { e, text });
  if (LOGGED_EVENTS.has(e)) {
    addLog(lifeLog, text, talkLang());
    saveLog(lifeLog);
  }
  if (!lifePending.includes(text)) lifePending.push(text);
  if (lifePending.length > 4) lifePending.shift();
  if (DIRECT_EVENTS.has(e)) {
    lifePendingDirect = true;
    ctrl.attend(5);
  }
  window.clearTimeout(lifeFlushTimer);
  lifeFlushTimer = window.setTimeout(lifeFlush, 1200);
}
function lifeFlush(): void {
  if (!lifeSlot || !lifePending.length || lifeBusy) return;
  const text = lifePending.join(' ');
  const direct = lifePendingDirect;
  lifePending = [];
  lifePendingDirect = false;
  void lifeAsk(text, direct ? 'event' : 'notice');
}

/** 給 AI 看的「現在在做什麼、在哪裡」 */
function lifeDoing(lang: Lang): string {
  // 正在做 AI 選的一段活動：說是哪段活動、做了多久（被打斷後可以接著做）
  const a = ctrl.activity;
  if (a) {
    const n = intentName(a.i, lang);
    return lang === 'ja_jp' ? `「${n}」の途中（${a.sec}秒くらい）` : lang === 'en_us' ? `in the middle of "${n}" (about ${a.sec}s in)` : `「${n}」做到一半（大約 ${a.sec} 秒了）`;
  }
  const m = ctrl.doing;
  const D: Record<string, [string, string, string]> = {
    idle: ['輕輕飄著', 'ふわふわ浮かぶ', 'floating gently'],
    wander: ['飛來飛去', 'あちこちとぶ', 'flying around'],
    observe: ['東張西望', 'きょろきょろ', 'looking around'],
    approach: ['待在家人前面', 'かぞくの前にいる', 'staying near the family'],
    rest: ['在地上休息', 'ゆかでやすむ', 'resting on the ground'],
    sleep: ['睡覺', 'ねる', 'sleeping'],
    dance: ['跳舞', 'おどる', 'dancing'],
    flourish: ['自己繞圈圈玩', 'くるくるあそぶ', 'playing in circles'],
    eat: ['吃東西', 'たべる', 'eating'],
  };
  const i = lang === 'zh_tw' ? 0 : lang === 'ja_jp' ? 1 : 2;
  return (D[m] ?? D.idle)[i];
}
function lifeWhere(lang: Lang): string {
  const b = stage.bounds();
  const x = ctrl.pos.x / Math.max(0.1, b.maxX);
  const h = (ctrl.pos.y - b.minY) / Math.max(0.1, b.maxY - b.minY);
  const W: Record<Lang, [string, string, string, string, string]> = {
    zh_tw: ['左邊', '右邊', '中間', '上面', '下面'],
    ja_jp: ['ひだり', 'みぎ', 'まんなか', 'うえのほう', 'したのほう'],
    en_us: ['left', 'right', 'middle', 'top', 'bottom'],
  };
  const w = W[lang];
  const side = x < -0.35 ? w[0] : x > 0.35 ? w[1] : w[2];
  const vert = h > 0.65 ? w[3] : h < 0.3 ? w[4] : '';
  return lang === 'en_us' ? `${vert ? vert + ' ' : ''}${side}` : `${side}${vert}`;
}

/** 鏡頭看到的人在哪一邊（給 AI 看；只知道位置，不知道是什麼東西） */
function lifeSeen(lang: Lang): string {
  if (!(lifeSlot === 'lifelive' && sensor.on && performance.now() - lastPersonAt < 5000)) return '';
  const side = personX < -0.3 ? 0 : personX > 0.3 ? 1 : 2;
  const W: Record<Lang, [string, string, string]> = {
    zh_tw: ['有人在畫面左邊', '有人在畫面右邊', '有人在畫面正前方'],
    ja_jp: ['画面のひだりに人がいる', '画面のみぎに人がいる', '画面のまんまえに人がいる'],
    en_us: ['someone on the left', 'someone on the right', 'someone right in front'],
  };
  return W[lang][side];
}
// 動態生命模式：人離開一陣子、或一直在鏡頭前忙時，告訴 AI（要不要說話由 AI 決定）
let lifeSawPerson = false;
let lifeBusySince = 0;
window.setInterval(() => {
  if (lifeSlot !== 'lifelive' || !sensor.on) {
    lifeSawPerson = false;
    return;
  }
  const now = performance.now();
  const present = now - lastPersonAt < 5000;
  if (present && !lifeSawPerson) {
    lifeSawPerson = true;
    lifeBusySince = now;
  } else if (!present && lifeSawPerson && now - lastPersonAt > 600_000) {
    lifeSawPerson = false;
    lifeEvent('left');
  } else if (present && now - lifeBusySince > 180_000) {
    lifeBusySince = now;
    lifeEvent('busy');
  }
}, 5000);

// 動態生命模式＋主人同意「看畫面」：鏡頭前有人時，最多每 30 秒把低解析度截圖送到家裡電腦的 AI 看一下
// （不送雲端、不存檔）。看到的描述給 AI 參考；出現新東西時讓 AI 決定要不要說一句。
let lifeSight: (Sight & { at: number }) | null = null;
let lifeLooking = false;
let lifeLookAt = -Infinity;
let lifeSawAt = -Infinity;
let lifeLookFails = 0;
/** 已經跟 AI 說過的東西（30 分鐘內不再說） */
const lifeThingsTold = new Map<string, number>();
/** 人、身體部位、姿勢（不算「新東西」） */
const PERSONISH = /人|主人|頭|臉|手|身體|眼|頭髮|衣服|person|people|man|woman|face|head|hand|body|hair|eye|顔|かお|あたま|からだ|ひと/i;
function lifeVision(): boolean {
  return lifeSlot === 'lifelive' && sensor.on && lifeVisionOn();
}
function lifeSightText(): string {
  if (!lifeSight || performance.now() - lifeSight.at > SIGHT_FRESH * 1000) return '';
  return lifeSight.desc || lifeSight.things.join(talkLang() === 'en_us' ? ', ' : '、');
}
async function lifeLook(): Promise<void> {
  const now = performance.now();
  if (!lifeVision() || lifeLooking || document.visibilityState !== 'visible') return;
  if (now - lastPersonAt > 5000 || now - lifeLookAt < LOOK_EVERY * 1000 * Math.min(4, 1 + lifeLookFails)) return;
  const cfg = loadBrain();
  if (!cfg.on || !cfg.url || !navigator.onLine) return;
  const img = snapshot(sensor.video, sensor.facing === 'user');
  if (!img) return;
  lifeLooking = true;
  lifeLookAt = now;
  const epoch = lifeEpoch;
  const lang = talkLang();
  sensorBox.classList.add('looking');
  const raw = await look(cfg, VISION_PROMPT[lang], img);
  sensorBox.classList.remove('looking');
  lifeLooking = false;
  if (epoch !== lifeEpoch || !lifeVision()) return;
  const sight = raw ? parseVision(raw) : null;
  if (!sight) {
    lifeLookFails++;
    return;
  }
  lifeLookFails = 0;
  // 新東西：連續兩次都看到（AI 看圖每次說法會變，看一次不算）、30 分鐘內沒提過、不是人的姿勢或身體部位
  const now2 = performance.now();
  const prev = lifeSight && now2 - lifeSight.at < 3 * 60_000 ? lifeSight.things : [];
  const fresh = sight.things.filter((x) => !PERSONISH.test(x) && prev.some((p) => p.includes(x) || x.includes(p)) && now2 - (lifeThingsTold.get(x) ?? -Infinity) > 30 * 60_000);
  lifeSight = { ...sight, at: now2 };
  monitorLog('look', { desc: sight.desc, things: sight.things, fresh });
  if (fresh.length && now2 - lifeSawAt > SAW_EVERY * 1000 && ctrl.mode !== 'sleep') {
    lifeSawAt = now2;
    for (const x of fresh) lifeThingsTold.set(x, now2);
    // 只說「看到什麼東西」，不說人的動作（以前會被說成「主人回頭了！」）
    lifeEvent('saw', fresh.join(lang === 'en_us' ? ', ' : '、'));
  }
}
window.setInterval(() => void lifeLook(), 5000);

/** 文字生命模式可以關掉聲音；語音、動態生命模式一定念（全部靜音時照樣不出聲） */
function lifeVoice(): boolean {
  return lifeSlot === 'lifetext' ? lifeTextVoiceOn() : !!lifeSlot;
}

/** 即時語音暫時不能用（轉接程式還沒更新、沒金鑰、免費額度用完）：這段時間直接用裝置內建語音 */
let ttsOffUntil = 0;
/** 說話時暫停聽（避免聽到自己的聲音） */
function lifeDeaf(sec: number): void {
  talkDeafUntil = performance.now() + sec * 1000 + 500;
  listener.pausedUntil = voiceAge.pausedUntil = talkDeafUntil;
}
/**
 * 生命模式的說話（第三階段）：先請家裡電腦用微軟神經語音即時念（自然、有心情的語調，前面有紫水晶鈴聲），
 * 不能用時改用裝置內建的語音；不用悅靈語假裝成自由對話。
 */
// ---- 說話排隊：一次只說一句，說完（停一下）才說下一句；新的一句來時，還沒說的自言自語就不說了 ----
interface LifeLine {
  text: string;
  lang: Lang;
  feeling: Feeling;
  epoch: number;
  at: number;
  /** 回應主人（不會被新的話擠掉） */
  direct: boolean;
}
let lifeLines: LifeLine[] = [];
let lifeTalking = false;
/** 被打斷時叫醒正在等的那一句 */
let lifeLineCut: (() => void) | null = null;
const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    const id = window.setTimeout(() => {
      lifeLineCut = null;
      resolve();
    }, ms);
    lifeLineCut = () => {
      window.clearTimeout(id);
      lifeLineCut = null;
      resolve();
    };
  });
function lifeLine(text: string, lang: Lang, feeling: Feeling, direct: boolean): void {
  // 還沒說的自言自語讓位給新的話；回應主人的最多留一句
  lifeLines = lifeLines.filter((l) => l.direct).slice(-1);
  lifeLines.push({ text, lang, feeling, epoch: lifeEpoch, at: performance.now(), direct });
  monitorLog('queue', { text, direct, waiting: lifeLines.length - 1, talking: lifeTalking });
  if (!lifeTalking) void lifeLinesPump();
}
async function lifeLinesPump(): Promise<void> {
  lifeTalking = true;
  try {
    while (lifeLines.length) {
      const l = lifeLines.shift()!;
      // 換了模式、或等太久（20 秒）就不說了
      if (l.epoch !== lifeEpoch || !lifeSlot || performance.now() - l.at > 20_000) continue;
      const en = l.lang === 'en_us';
      const read = Math.max(3.2, l.text.length * (en ? 0.07 : 0.23));
      if (lifeVoice()) {
        const sec = await lifeSpeak(l.text, l.lang, l.feeling);
        if (l.epoch !== lifeEpoch) continue;
        // sec＝還要等多久才念完（神經語音是播放長度；內建語音已經念完，回傳 0），念完再停半秒
        await wait(Math.max(sec, 0) * 1000 + 500);
      } else {
        hud.say(l.text, read * 1000);
        lastSpoke = performance.now();
        await wait(Math.min(read, 4) * 1000);
      }
    }
  } finally {
    lifeTalking = false;
  }
}
/** 打斷她（主人打字、點泡泡）：停掉正在說的、不說還沒說的 */
function lifeHush(): void {
  if (!lifeTalking && !lifeLines.length) return;
  monitorLog('hush', { waiting: lifeLines.length });
  lifeLines = [];
  sound.stopClips();
  window.speechSynthesis?.cancel();
  talkDeafUntil = Math.min(talkDeafUntil, performance.now() + 300);
  listener.pausedUntil = voiceAge.pausedUntil = talkDeafUntil;
  lifeLineCut?.();
}

/** 念一句話：回傳還要等幾秒才念完（念的時候才顯示泡泡） */
async function lifeSpeak(text: string, lang: Lang, feeling: Feeling = null): Promise<number> {
  const vol = sound.level('voice');
  const est = Math.min(14, 0.8 + text.length * (lang === 'en_us' ? 0.07 : 0.2));
  const show = (sec: number) => {
    hud.say(text, Math.max(3200, sec * 1000 + 600));
    lastSpoke = performance.now();
    lifeDeaf(sec);
  };
  if (vol <= 0) {
    show(est);
    return est;
  }
  const epoch = lifeEpoch;
  const cfg = loadBrain();
  if (performance.now() >= ttsOffUntil && navigator.onLine) {
    const r = await fetchTts(cfg, text, lang, feeling);
    if (epoch !== lifeEpoch || !lifeSlot) return 0;
    if (r.ok) {
      const buf = await sound.decodeMono(r.audio);
      const sec = buf ? sound.playClip(buf) : 0;
      if (sec > 0) {
        show(sec);
        monitorLog('voice', { how: 'neural', sec: Math.round(sec * 10) / 10 });
        return sec;
      }
    } else {
      if (r.why !== 'net') ttsOffUntil = performance.now() + 10 * 60_000;
      monitorLog('voice', { how: 'device', why: r.why });
    }
  }
  show(est);
  return deviceSpeak(text, lang, est);
}
/** 裝置內建語音：念完才回傳 0（最多等預估時間 + 3 秒） */
function deviceSpeak(text: string, lang: Lang, est: number): Promise<number> {
  const s = window.speechSynthesis;
  const vol = sound.level('voice');
  if (!s || vol <= 0) return Promise.resolve(est);
  let done: (sec: number) => void = () => {};
  const p = new Promise<number>((resolve) => (done = resolve));
  window.setTimeout(() => done(0), (est + 3) * 1000);
  s.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const tag = SPEECH_LANG[lang];
  u.lang = tag;
  const v = pickVoice(s.getVoices(), tag, loadTtsVoices()[lang]);
  if (v) u.voice = v;
  u.pitch = 1.35;
  u.rate = 1;
  u.volume = vol;
  u.onend = u.onerror = () => {
    talkDeafUntil = Math.min(talkDeafUntil, performance.now() + 400);
    listener.pausedUntil = voiceAge.pausedUntil = talkDeafUntil;
    done(0);
  };
  s.speak(u);
  return p;
}

/** 照 AI 的意圖讓控制器行動 */
function lifeDo(i: LifeIntentName): void {
  monitorLog('intent', { i, cake: !!stage.cake, at: ctrl.doing });
  lifeRecent.push(i);
  bumpLike(lifeLikes, i);
  saveLikes(lifeLikes);
  if (lifeRecent.length > 5) lifeRecent.shift();
  if (i === 'eat_cake') {
    // 地上有蛋糕就飛過去吃；沒有的話（AI 說錯）就在附近找找看
    if (stage.cake && pet.hunger < MAX_HUNGER - 0.5) ctrl.seekCake(stage.cake.position);
    else ctrl.intend('search');
    return;
  }
  ctrl.intend(i);
}

/**
 * 問 AI：chat＝主人說的話（一定要等回應，雲端優先）；event＝主人做了什麼；decide＝自己決定下一步（多半安靜）。
 * 回傳 AI 有沒有回答。
 */
async function lifeAsk(text: string, how: 'chat' | 'event' | 'notice' | 'decide'): Promise<boolean> {
  if (!lifeSlot) return false;
  if (lifeBusy) {
    // 正在想：主人說的話、做的事排隊，想完再處理；自己決定下一步就不用排
    if (how !== 'decide' && !lifePending.includes(text)) {
      lifePending.push(text);
      if (how === 'chat' || how === 'event') lifePendingDirect = true;
    }
    return false;
  }
  const cfg = loadBrain();
  if (!cfg.on || !cfg.url || !navigator.onLine) {
    lifeFail();
    return false;
  }
  lifeBusy = true;
  lifeLastAsk = performance.now();
  const epoch = lifeEpoch;
  const lang = talkLang();
  if (how === 'chat') hud.say('…', 9000);
  const system =
    // 生命模式專用的「她是誰、怎麼說話」（不用原本陪聊的助理設定；不叫主人，認得聲音就叫名字）
    lifeSystem(pet, { speaker: personNow(), family: people.map((p) => p.name), notes: brainMem.notes }, lang) +
    (how === 'chat' ? lifeChatRules : lifeRules)(
      {
        doing: lifeDoing(lang),
        where: lifeWhere(lang),
        energy: pet.energy,
        hunger: (pet.hunger / MAX_HUNGER) * 100,
        asleep: ctrl.mode === 'sleep',
        recent: lifeRecent.map((i) => intentName(i, lang)),
        lastActivity: how === 'decide' ? lifeRecent.at(-1) : undefined,
        voice: lifeVoice() && sound.level('voice') > 0,
        cake: !!stage.cake,
        scene: lifeScene(lang),
        mic: lifeSlot === 'lifemic' || lifeSlot === 'lifelive',
        camera: lifeSlot === 'lifelive' && sensor.on,
        seen: lifeSeen(lang),
        vision: lifeVision(),
        sight: lifeVision() ? lifeSightText() : '',
        rhythm: rhythmText(new Date().getHours(), HABITS[pet.personality], lang),
        today: todayLog(lifeLog, lang),
        likes: topLikes(lifeLikes).map((i) => intentName(i, lang)),
        collection: treasureList(lifeTreasures, lang),
        treasures: treasureCount(lifeTreasures),
        prefer: [...(PREFER[pet.personality] ?? []), ...topLikes(lifeLikes)],
        hasNotes: brainMem.notes.length > 0,
      },
      lang,
    );
  // 觀察紀錄：給 AI 的生命模式狀態（系統說明的最後一段：現在的狀態、畫面、作息、今天的事…）
  if (monitorOn()) monitorLog('ask', { how, text, life: system.slice(-3500) });
  // 直接跟她說的話：附一句提醒（不記進對話）。實驗發現她會學對話紀錄裡只有動作的回合，變成都不回話
  const askText = how === 'chat' ? `${text}\n${LIFE_CHAT_NUDGE[lang]}` : text;
  let raw: string | null = null;
  // 主人說的話：雲端 AI（只有主人本人、有每日每月上限）→ 家裡電腦的 AI
  if (how === 'chat' && (!isCloudTired() || Date.now() >= (cloudTired?.check ?? 0))) {
    const c = await askCloud(cfg, system, brainMem, askText, lang);
    if (c.ok) {
      raw = c.text;
      if (cloudTired) setCloudTired(null);
    } else {
      if (c.why === 'budget') setCloudTired(c.scope ?? 'day');
      cloudNotice(c.why);
    }
  }
  raw ??= await ask(cfg, system, brainMem, askText, 25000, lang);
  lifeBusy = false;
  if (how === 'chat') hud.say('', 1);
  // 這段時間換了模式或關掉了：舊的回答不用
  if (!lifeSlot || epoch !== lifeEpoch) return false;
  monitorLog('reply', { how, raw });
  // 有人告訴她名字（AI 寫了 [名字：…]）：把剛才聽到的聲音記成這個名字（只存在這台手機）
  const named = raw ? nameTag(raw) : null;
  if (named && lastVoice && performance.now() - lastVoice.at < 90_000 && voiceIdOn()) {
    addPerson(people, named, lastVoice.feat);
    savePeople(people);
    currentPerson = { name: named, at: performance.now() };
    monitorLog('voice-name', { name: named, people: people.length });
  }
  if (!raw) {
    lifeFail();
    window.setTimeout(lifeFlush, 50);
    return false;
  }
  lifeOk();
  let r = parseLifeReply(raw, lang);
  // 用了別的語言（例如設定中文卻回日文）：再請家裡電腦的 AI 用設定的語言回答一次；還是不對就只留對的句子
  if (r.text && mixedLanguage(r.text, lang)) {
    lifeBusy = true;
    const again = await ask(cfg, system, brainMem, `${text}\n${LIFE_LANG_REMIND[lang]}`, 25000, lang);
    lifeBusy = false;
    if (!lifeSlot || epoch !== lifeEpoch) return false;
    const r2 = again ? parseLifeReply(again, lang) : null;
    if (r2 && (!r2.text || !mixedLanguage(r2.text, lang))) r = { ...r2, intent: r2.intent ?? r.intent, actions: r2.actions.length ? r2.actions : r.actions };
    if (r.text && mixedLanguage(r.text, lang)) r = { ...r, text: dropMixedSentences(r.text, lang) };
  }
  // 自言自語（自己決定、或只是看到聽到什麼）：隔太近不說；說到畫面裡沒有的東西（花、沒有的蛋糕…）也不說
  if (r.text && (how === 'decide' || how === 'notice')) {
    const now = performance.now();
    const tooSoon = now - lifeSelfTalkAt < SELF_TALK_GAP[how];
    const fake = madeUp(r.text, lang, { cake: !!stage.cake, scene: lifeScene(lang) });
    if (tooSoon || fake) {
      monitorLog('silenced', { text: r.text, why: fake ? 'made_up' : 'too_soon', sinceLastSec: Math.round((now - lifeSelfTalkAt) / 1000) });
      r = { ...r, text: '' };
    } else lifeSelfTalkAt = now;
  }
  // 記憶：主人說的話、發生的事、悅靈做的事（自己決定下一步的提示不記）
  if (how !== 'decide') remember(brainMem, 'user', text);
  if (how === 'chat') {
    addLog(lifeLog, SAID_LOG[lang](text.length > 24 ? `${text.slice(0, 24)}…` : text), lang);
    saveLog(lifeLog);
  }
  const did = [
    ...(r.intent ? [`（意圖：${intentName(r.intent, lang)}）`] : []),
    ...(r.actions.length ? [`（${GESTURE_LABEL[lang]}：${r.actions.map((g) => gestureName(g, lang)).join('、')}）`] : []),
  ].join('');
  // 只記有說話的回合（只有動作的回合放進對話紀錄，AI 會學著也只寫動作、不回話）；做了什麼另外記在 lifeRecent
  if (r.text) remember(brainMem, 'allay', `${r.text}${did}`.trim());
  if (how === 'chat') for (const n of r.notes) addNote(brainMem, n);
  saveMemory(brainMem);
  // 心情表現在動作和外觀上
  if (r.feeling) ctrl.setFeeling(r.feeling);
  // 回應主人時看著主人（自己決定下一步時照自己的視線）
  if (how === 'chat' || how === 'event') ctrl.attend(r.text ? 8 : 4);
  // 先做動作（手、頭、翅膀），做完再照意圖行動
  if (r.actions.length) ctrl.gesture(r.actions);
  if (r.intent) {
    const i = r.intent;
    const wait = r.actions.reduce((s, g) => s + GESTURE_SEC[g], 0);
    if (wait) window.setTimeout(() => lifeSlot && epoch === lifeEpoch && lifeDo(i), wait * 1000);
    else lifeDo(i);
  }
  // 說話排隊（說完一句才說下一句）
  if (r.text) lifeLine(r.text, lang, r.feeling, how === 'chat' || how === 'event');
  // 下一次自己決定至少隔 6 秒
  lifeNextAt = performance.now() + 6000;
  window.setTimeout(lifeFlush, 50);
  return true;
}

/** AI 連不上：安全待機（控制器照舊讓她安靜飄著），隔一段時間再試；告訴主人（5 分鐘內不重複） */
function lifeFail(): void {
  lifeFails++;
  lifeNextAt = performance.now() + retryDelay(lifeFails) * 1000;
  // AI 連不上：手上 AI 選的活動先多做一會兒（不會突然停在原地）
  ctrl.extendActivity(retryDelay(lifeFails));
  if (!lifeStandby) {
    lifeStandby = true;
    lifeChipShow();
  }
  const now = performance.now();
  if (now - lifeStandbyToastAt > 300_000) {
    lifeStandbyToastAt = now;
    hud.toast(t('life.standby'));
  }
}
function lifeOk(): void {
  lifeFails = 0;
  if (lifeStandby) {
    lifeStandby = false;
    lifeChipShow();
    hud.toast(t('life.back'));
  }
}

/** 想自己決定下一步（控制器閒下來時、或很久沒決定時） */
function lifeDecide(): void {
  if (!lifeSlot || lifeBusy || lifePending.length || ctrl.posed) return;
  const now = performance.now();
  if (now < lifeNextAt || document.visibilityState !== 'visible') return;
  void lifeAsk(lifeEventText(ctrl.mode === 'sleep' ? 'asleepCheck' : 'decide', talkLang()), 'decide');
}
// 閒著太久（例如控制器在做很長的事）或在睡覺時：定期問一下
window.setInterval(() => {
  if (!lifeSlot || lifeBusy) return;
  const since = performance.now() - lifeLastAsk;
  if (ctrl.mode === 'sleep' ? since > 90_000 : ctrl.mode === 'idle' && since > 25_000) lifeDecide();
}, 5000);

// 生命模式的狀態標籤（左上）：正在生命模式／AI 休息中，旁邊是「停止」
const lifeChip = document.createElement('div');
lifeChip.className = 'life-chip';
const lifeChipText = document.createElement('span');
const lifeChipStop = document.createElement('button');
lifeChipStop.className = 'btn small';
lifeChip.append(lifeChipText, lifeChipStop);
overlay.appendChild(lifeChip);
lifeChipStop.addEventListener('click', () => {
  playSfx('click');
  hud.setSelected(null);
  lifeStop();
});
function lifeChipShow(): void {
  lifeChip.classList.toggle('on', !!lifeSlot);
  lifeChip.classList.toggle('standby', lifeStandby);
  const label = lifeSlot === 'lifemic' ? t('lifeMicSlot') : lifeSlot === 'lifelive' ? t('lifeLiveSlot') : t('lifeTextSlot');
  const eye = lifeSlot === 'lifelive' && lifeVisionOn() ? `・${t('life.seeing')}` : '';
  lifeChipText.textContent = lifeStandby ? `${label}・${t('life.standbyChip')}` : `${label}${eye}`;
  lifeChipStop.textContent = t('life.stop');
}

function lifeStart(slot: LifeSlot): void {
  if (lifeSlot === slot) return;
  const first = !lifeSlot;
  lifeSlot = slot;
  lifeEpoch++;
  lifeSight = null;
  lifeLookFails = 0;
  if (slot === 'lifelive' && !lifeVisionOn()) visionHintOnce();
  lifeFails = 0;
  lifeStandby = false;
  lifePending = [];
  ctrl.setLife(true);
  lifeChipShow();
  if (first) hud.toast(t('life.on'));
  // 先確認家裡電腦連得上（不通就安全待機）
  const cfg = loadBrain();
  void listModels(cfg).then((r) => {
    if (lifeSlot !== slot) return;
    if (!r.ok) return lifeFail();
    lifeNextAt = 0;
    // 上次在生命模式是 30 分鐘以前：告訴 AI 過了多久（不編造這段時間的事）
    const last = lastLifeSeen();
    if (first && last && Date.now() - last > 30 * 60_000) lifeEvent('back', awayText(last, Date.now(), HABITS[pet.personality], talkLang()));
    else lifeDecide();
    markLifeSeen();
  });
}
// 生命模式開著時，每分鐘記一下「最後在的時間」（下次打開 App 時算離開多久）
window.setInterval(() => {
  if (lifeSlot && document.visibilityState === 'visible') markLifeSeen();
}, 60_000);
/** 第一次用動態生命模式、還沒打開「看畫面」時提示一次 */
function visionHintOnce(): void {
  try {
    if (localStorage.getItem('fairypocket.lifevisionhint.v1')) return;
    localStorage.setItem('fairypocket.lifevisionhint.v1', '1');
  } catch {
    return;
  }
  window.setTimeout(() => hud.toast(t('life.visionHint')), 2500);
}
function lifeStop(): void {
  lifeHush();
  if (!lifeSlot) return;
  lifeSlot = null;
  lifeEpoch++;
  lifeSight = null;
  sensorBox.classList.remove('looking');
  markLifeSeen();
  lifePending = [];
  lifeStandby = false;
  window.speechSynthesis?.cancel();
  ctrl.setLife(false);
  lifeChipShow();
  micOff();
  sensorOff();
  liveOn = false;
  assistant.showInput(false);
}

// 主人離開一陣子再回來：告訴 AI（要不要打招呼由 AI 決定）
let lifeHiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    lifeHiddenAt = Date.now();
    if (lifeSlot) markLifeSeen();
  } else if (lifeSlot && lifeHiddenAt && Date.now() - lifeHiddenAt > 10 * 60_000) {
    lifeEvent('back', awayText(lifeHiddenAt, Date.now(), HABITS[pet.personality], talkLang()));
  }
});

/** 揮手感應的冷卻：AI 判斷時 12 秒、規則反應時 8 秒內不重複（以前每次感應到都揮手） */
let lastWaveAt = -Infinity;

/** 動態模式的鏡頭休息中：點畫面或說話就再打開 */
function liveWake(): void {
  if (liveOn && !sensor.on) {
    lastPersonAt = performance.now();
    void sensorOn();
  }
}
window.addEventListener('pointerdown', liveWake);

const cameraEvents: ArEvents = {
  wave: () => {
    const now = performance.now();
    // 揮手偵測偶爾會誤判：AI 生命模式 45 秒內只算一次
    if (now - lastWaveAt < (lifeSlot ? 90_000 : brainReady() ? 12_000 : 8_000)) return;
    lastWaveAt = now;
    cheer(pet, 5);
    // AI 生命模式：沒有固定的揮手回應，交給 AI
    if (lifeSlot) return lifeEvent('wave');
    const rule = () => {
      ctrl.waveBack();
      say('waveBack');
      stage.spawn('heart', ctrl.headTop(new THREE.Vector3()), 3);
    };
    // AI 優先：AI 決定要揮手、點頭、害羞遮臉還是說句話
    void aiEvent('wave').then((ok) => ok || rule());
  },
  // 畫面裡有人在動：悅靈好奇地往那邊看（不要太頻繁）
  motion: (x, y) => {
    if (liveOn) return liveMotion(x, y);
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
    // 動態模式：鏡頭不能用時還是可以說話、打字，所以不取消選取
    if (liveOn) hud.showItem(t('live.noCam'));
    else {
      hud.showItem(t('camDenied'));
      hud.setSelected(null);
    }
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
  // AI 生命模式：要不要跳舞由 AI 決定（夥伴照舊）
  if (lifeSlot) lifeEvent('noteBlock');
  else if (!ctrl.posed) ctrl.dance(top);
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
    lifeIdle: () => lifeDecide(),
    hum: () => sound.speak(pet.personality),
    searched: (at) => lifeSearched(at),
    treasure: (at) => {
      stage.spawn('sparkle', at.clone().add(new THREE.Vector3(0, -0.1, 0)), 4);
      monitorLog('treasure', { count: treasureCount(lifeTreasures) });
    },
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
  sound.effect('sounds/note/harp', 0.9, Math.pow(2, (note - 12) / 12), 0, 'records');
  stage.spawn('note', block.position.clone().add(new THREE.Vector3(0, 0.35, 0)), 1);
  // 悅靈與夥伴飛過來跳舞
  const wasDancing = ctrl.dancing;
  const top = block.position.clone().add(new THREE.Vector3(0, 0.95, 0));
  if (!ctrl.dancing) cheer(pet, 4);
  if (lifeSlot) lifeEvent('noteBlock');
  else ctrl.dance(top);
  friends.forEach((f, i) => f.ctrl.dance(top.clone().add(new THREE.Vector3(Math.cos(i * 2.1) * 0.7, 0.15 * i, Math.sin(i * 2.1) * 0.5))));
  pet.memory.lastDanceAt = Date.now();
  if (!wasDancing && ctrl.dancing) say('dance');
}

const hud = new Hud(overlay, {
  voicePreview: () => void speakText(talkLine('greet', getLang(), pet.name, pet.personality)),
  babblePreview: () => {
    sound.unlock();
    sound.babble(t('babble.sample'), pet.personality);
  },
  senseTest: () =>
    new SenseTest({
      root: overlay,
      context: () => (sound.unlock(), sound.context),
      pauseSenses: () => hud.setSelected(null),
      speechLang: () => SPEECH_LANG[getLang()],
    }).open(),
  toolAllowed: (slot) => !isLifeSlot(slot) || lifeAllowed(),
  lifeAllowed,
  lifeChanged: () => {
    if (!lifeVisionOn()) {
      lifeSight = null;
      sensorBox.classList.remove('looking');
    }
    lifeChipShow();
  },
  select: (slot) => {
    const prev = currentSlot;
    currentSlot = slot;
    // AI 生命模式：選了就開始；拿起食物、玩具、方塊時繼續（她照樣過自己的生活），
    // 換成別的說話方式、從生命模式「收起」、或按「停止」才結束
    if (isLifeSlot(slot)) {
      if (!lifeAllowed()) {
        hud.toast(t('life.noAi'));
        window.setTimeout(() => hud.setSelected(null), 0);
        return;
      }
      lifeStart(slot);
    } else if (lifeSlot && (slot === null ? isLifeSlot(prev) : SENSE_TOOLS.has(slot))) lifeStop();
    // 動態模式 = 前鏡頭（看人、揮手）＋麥克風（說話）
    // AI 文字／語音／動態 = 文字／語音／動態 ＋ 雲端 AI（第三層）
    cloudMode = slot === 'aitext' || slot === 'aimic' || slot === 'ailive';
    const live = slot === 'live' || slot === 'ailive' || lifeSlot === 'lifelive';
    if (live !== liveOn) lastPersonAt = performance.now();
    liveOn = live;
    if (!liveOn) ctrl.setPerson(null);
    // 文字：只打字；語音：麥克風；動態：鏡頭＋麥克風（生命模式照它自己的種類）
    const voice = slot === 'mic' || slot === 'aimic' || lifeSlot === 'lifemic';
    if (liveOn || voice) void micOn();
    else micOff();
    if (liveOn) void sensorOn();
    else sensorOff();
    assistant.showInput(liveOn || voice || slot === 'text' || slot === 'aitext' || !!lifeSlot);
    if (cloudMode) hud.toast(t('cloud.on'));
    if (slot !== 'note') stage.removeNoteBlock();
  },
  call: () => {
    playSfx('bell');
    // AI 生命模式：聽到鈴鐺要不要過來由 AI 決定
    if (lifeSlot) lifeEvent('called');
    else ctrl.call();
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
  games: () => keyGame.openGames(),
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
    sound.speak(pet.personality);
  },
  soundAvailable: () => sound.available,
  volumes: () => ({ vol: { ...sound.vol }, muted: sound.muted }),
  setVolume: (k, v) => {
    sound.unlock();
    sound.setVolume(k, v);
    music.refresh();
  },
  previewVolume: (k) => {
    // 放開滑桿時播一聲聽聽看
    if (k === 'voice' || k === 'master') sound.speak(pet.personality);
    else if (k === 'records') sound.effect('sounds/note/harp', 0.9, 1, 0, 'records');
    else if (k === 'effects') playSfx('click');
  },
  setMuted: (on) => {
    sound.unlock();
    sound.setMuted(on);
    music.refresh();
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

// ---------- 小遊戲：按鍵遊戲 ----------

const SPEECH_LANG: Record<string, string> = { zh_tw: 'zh-TW', ja_jp: 'ja-JP', en_us: 'en-US' };

/**
 * 用裝置內建的語音說話（音量跟著「悅靈的叫聲與回應」）。
 * 平常是悅靈的聲音（偏高、偏可愛）；demo = 示範發音，念得慢一點、音高接近自然，讓小孩聽清楚。
 * 中文用台灣的語音（zh-TW）。念完（或最多 8 秒）時結束。
 */
/** 神經語音的聲音（轉成錄音的格式，才能套變聲；同一句只轉一次） */
const neuralClips = new WeakMap<AudioBuffer, Clip>();

async function speakText(text: string, lang: Lang = getLang(), demo = false): Promise<void> {
  const s = window.speechSynthesis;
  const vol = sound.level('voice');
  if (vol <= 0 || !text) return;
  // 有事先做好的神經語音就播它（自然很多）；悅靈說話時套上目前選的變聲，示範念法用原本的聲音
  const ctx = sound.context;
  if (ctx) {
    const buf = await neuralBuffer(ctx, lang, text);
    if (buf) {
      s?.cancel();
      let c = neuralClips.get(buf);
      if (!c) neuralClips.set(buf, (c = { rate: buf.sampleRate, data: buf.getChannelData(0) }));
      const len = sound.playClip(clipBuffer(ctx, c, demo ? null : voiceStyle));
      await new Promise((r) => window.setTimeout(r, len * 1000));
      return;
    }
  }
  // 沒有做好的自然語音（例如 AI 臨時想的話、天氣這種每次不一樣的話）：
  // 不用裝置的朗讀（太像機器），改成「悅靈語」（像動物森友會那樣一個字一聲），字顯示在泡泡或對話紀錄裡
  void lang;
  const len = sound.babble(text, pet.personality);
  await new Promise((r) => window.setTimeout(r, len * 1000));
}

// ---------- 小助理：天氣、時間、計時、音樂、查資料 ----------
const assistant = new Assistant(overlay, { lang: () => talkLang(), say: assistSay }, (text) => void answerText(text));
// 說話模式：悅靈說的話顯示在左下的對話紀錄（飛得比較高時也看得到）
hud.sayHook = (text) => {
  if (!assistant.talking) return false;
  if (text !== '…') assistant.chat(pet.name, text);
  return true;
};

/** 助理的回答：說出來、顯示泡泡、做個動作 */
function assistSay(line: string, mood: Mood): void {
  const now = performance.now();
  const en = talkLang() === 'en_us';
  hud.say(line, Math.max(3200, line.length * (en ? 70 : 230)));
  void speakText(line, talkLang());
  const len = Math.min(14, 0.8 + line.length * (en ? 0.07 : 0.2));
  talkDeafUntil = now + len * 1000 + 500;
  listener.pausedUntil = voiceAge.pausedUntil = talkDeafUntil;
  const head = ctrl.headTop(new THREE.Vector3());
  if (mood === 'think') ctrl.setMode('curious', 2);
  else if (mood === 'oops') ctrl.setMode('oops', 1.6);
  else if (mood === 'sad') {
    ctrl.setMode('approach', 3);
    stage.spawn('heart', head, 2);
  } else if (mood === 'surprised') ctrl.setMode('startled', 1.2);
  else if (mood === 'shy') ctrl.setMode('tickled', 1.6);
  else if (mood === 'sleepy') ctrl.setMode('rest', 3);
  else if (mood === 'alarm') {
    playSfx('bell');
    ctrl.setMode('flip', 1.6);
    stage.spawn('note', head, 4);
  } else {
    ctrl.setMode('happy', 2);
    stage.spawn('note', head, 2);
  }
}

/** 精靈舞蹈的舞台與花圈（第一次用到時才用素材包的材質搭出來） */
let danceImgs: DanceImages | null = null;
let danceStage: THREE.Group | null = null;
let crown: THREE.Group | null = null;
let danceOn = false;
async function showDanceStage(on: boolean): Promise<void> {
  danceOn = on;
  if (on && !danceStage) {
    danceImgs = pack ? await loadImages(pack, DANCE_TEXTURES) : {};
    danceStage = buildDanceStage(danceImgs);
    crown = buildCrown(danceImgs);
  }
  if (!danceStage || !crown) return;
  if (danceOn) {
    stage.scene.add(danceStage);
    model.head.add(crown);
  } else {
    stage.scene.remove(danceStage);
    model.head.remove(crown);
  }
  // 平常放的方塊、蛋糕、床先藏起來，舞台才不會跟它們重疊
  for (const o of [stage.noteBlock, stage.cake, stage.bed, stage.jukebox]) if (o) o.visible = !danceOn;
  stage.showPlants(!danceOn);
}


/** 讀出貼紙簿的錄音；v0.25 存的（不分語言）當作目前語言的錄音 */
async function stickerClips(): Promise<Map<string, Clip>> {
  const m = await loadStickerClips();
  const ren = legacyRenames([...m.keys()], getLang());
  if (ren.length) {
    await renameStickerClips(ren);
    for (const [a, b] of ren) {
      m.set(b, m.get(a)!);
      m.delete(a);
    }
  }
  return m;
}

/** 貼紙簿：每張貼紙錄一段聲音（最長 5 秒），可以用原聲或變聲聽 */
const stickerBook = new StickerBook({
  root: overlay,
  click: () => playSfx('click'),
  record: async () => {
    sound.unlock();
    const ctx = sound.context;
    if (!ctx) return null;
    try {
      return await recordClip(ctx, 5);
    } catch {
      return null;
    }
  },
  play: (c, changed) => {
    sound.unlock();
    const ctx = sound.context;
    return ctx ? sound.playClip(clipBuffer(ctx, c, changed ? voiceStyle : null)) : 0;
  },
  voiceName: () => t(`voice.${voiceStyle}`),
  demo: (text, lang) => {
    sound.unlock();
    return speakText(text, lang, true);
  },
  load: stickerClips,
  save: saveStickerClip,
  // 背景音樂：自己作的開朗小曲（src/jingle.ts）
  musicStart: () => {
    sound.unlock();
    music.startJingle();
  },
  musicStop: () => music.stopJingle(),
  musicDuck: (l) => music.duckSong(l),
});

/** 精靈舞蹈：不支援語音辨識時用的「聽到聲音」偵測，與體感用的前鏡頭 */
const gameListener = new Listener();
const motion = new MotionTracker(document.body);
let lastSpot = { x: 0, y: 0 };

const CHEERS = [
  ['happy', 0.9],
  ['dance', 1.2],
  ['wave', 1.3],
  ['tickled', 1.0],
  ['flip', 0.8],
] as const;
let lastCheer = -1;

const keyGame = new KeyGameUI({
  root: overlay,
  click: () => playSfx('click'),
  hasSong: (p) => music.hasSong(p),
  playSong: (p, end) => {
    sound.unlock();
    return music.playSong(p, end);
  },
  stopSong: () => music.stopSong(),
  songProgress: () => music.songProgress(),
  begin: (mode) => {
    sound.unlock();
    ctrl.setPose('fly');
    if (mode === 'motion') {
      // 體感：不用舞台，悅靈變小、在鏡頭畫面上到處換位置
      model.root.scale.setScalar(0.7);
    } else {
      void showDanceStage(true);
      // 悅靈飛到舞台中間，專心陪玩
      ctrl.posePos.set(0, 1.05, 0.6);
    }
    requestAnimationFrame(resize);
  },
  chirp: () => sound.speak(pet.personality),
  micStart: async (onSpeech) => {
    sound.unlock();
    const ctx = sound.context;
    if (!ctx) return false;
    try {
      await gameListener.start(ctx, { start: () => {}, end: () => onSpeech() });
      return true;
    } catch {
      return false;
    }
  },
  micStop: () => gameListener.stop(),
  motionStart: async () => {
    const ok = await motion.start();
    if (ok) {
      document.body.classList.add('motion');
      stage.setAR(true);
    }
    return ok;
  },
  motionStop: () => {
    if (!motion.on && !document.body.classList.contains('motion')) return;
    motion.stop();
    document.body.classList.remove('motion');
    if (!arCam.on) stage.setAR(false);
  },
  allayScreen: () => {
    const v = ctrl.pos.clone().add(new THREE.Vector3(0, 0.15, 0)).project(stage.camera);
    return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
  },
  motionActivity: (x, y, r) => motion.activity(x, y, r),
  motionOverall: () => motion.overall(),
  openStickerBook: () => void stickerBook.open(),
  openSports: () => void openSports(),
  stickerClips,
  playClip: (c) => {
    sound.unlock();
    const ctx = sound.context;
    return ctx ? sound.playClip(clipBuffer(ctx, c, null)) : 0;
  },
  moveAllay: () => {
    // 換到畫面上另一個地方（跟上一個位置拉開距離），讓小朋友要移動身體
    const cam = stage.camera;
    let nx = 0;
    let ny = 0;
    for (let i = 0; i < 20; i++) {
      nx = (Math.random() * 2 - 1) * 0.72;
      ny = -0.4 + Math.random() * 0.9;
      if (Math.hypot(nx - lastSpot.x, ny - lastSpot.y) > 0.6) break;
    }
    lastSpot = { x: nx, y: ny };
    const p = new THREE.Vector3(nx, ny, 0.5).unproject(cam);
    const dir = p.sub(cam.position).normalize();
    const d = (-1.5 - cam.position.z) / dir.z;
    ctrl.posePos.copy(cam.position).addScaledVector(dir, d);
    sound.effect('sounds/mob/allay/item_thrown', 0.4, 1.2, 0, 'voice');
  },
  cheer: (text) => {
    // 答對：每次換一個不同的開心動作
    let i = Math.floor(Math.random() * CHEERS.length);
    if (i === lastCheer) i = (i + 1) % CHEERS.length;
    lastCheer = i;
    ctrl.perform(CHEERS[i][0], CHEERS[i][1]);
    hud.say(text);
    stage.spawn('heart', ctrl.headTop(new THREE.Vector3()), 2);
    sound.effect('sounds/block/amethyst/shimmer', 0.9, 1.3, 0, 'voice');
  },
  oops: () => ctrl.perform('oops', 1.2),
  wrong: () => sound.effect('sounds/mob/allay/hurt', 0.35, 0.95, 0, 'voice'),
  finish: (score) => {
    ctrl.perform('dance', 8);
    stage.spawn('heart', ctrl.headTop(new THREE.Vector3()), 6);
    if (score > 0) playSfx('levelup');
  },
  end: () => {
    void showDanceStage(false);
    model.root.scale.setScalar(1);
    ctrl.setPose(null);
    requestAnimationFrame(resize);
  },
  speak: (text, lang) => void speakText(text, lang),
  demo: (text, lang) => void speakText(text, lang, true),
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
  // 精靈舞蹈的舞台下次用新的材質重搭
  danceStage = null;
  crown = null;
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
  // 遊戲紀錄、設定、所有錄音也一起放進存檔
  const voice: Record<string, unknown> = {};
  try {
    for (const [k, v] of await allVoiceEntries()) voice[k] = packValue(v);
  } catch {
    // 讀不到錄音就只存悅靈
  }
  const file = new File([serialize(pet, Date.now(), { local: collectLocal(localStorage), voice })], name, { type: 'application/json' });
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
    const text = await file.text();
    if (!receive(parseSave(text))) return;
    // 存檔裡有遊戲紀錄與錄音：一起還原，重新載入後套用設定
    const ex = parseExtras(text);
    if (ex) {
      restoreLocal(localStorage, ex.local);
      await putVoiceEntries(Object.entries(ex.voice).map(([k, v]) => [k, unpackValue(v)]));
      hud.toast(t('saveRestoredAll'));
      window.setTimeout(() => location.reload(), 1500);
    }
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
function receive(data: PetState): boolean {
  const kind = linkKind(pet, data);
  if (kind === 'other' && !confirm(t('linkOther', { n: data.name }))) return false;
  if (kind === 'same-older' && !confirm(t('linkOlder'))) return false;
  Object.assign(pet, data, { onboarded: true });
  clearFriends();
  applyGlow();
  stage.removeBall();
  ctrl.setMode(pet.asleep ? 'sleep' : 'idle');
  hud.setName(pet.name);
  hud.updateStats(pet);
  save();
  hud.toast(t(kind === 'other' ? 'saveRestored' : 'linkSynced'));
  return true;
}

setInterval(save, 5000);
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  music.pause(document.hidden);
  if (document.hidden) {
    // 切到背景就關掉麥克風和鏡頭
    if (liveOn || talkOn || listener.on) hud.setSelected(null);
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
      if (lifeSlot) lifeEvent('bedTap');
      else if (ctrl.mode === 'sleep') ctrl.wake();
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
    if (lifeSlot) lifeEvent('firework');
    else ctrl.watch(p.clone().add(new THREE.Vector3(0, 2.6, 0)));
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
  // 點空白處：悅靈好奇地飛過去（AI 生命模式不自動飛過去）
  if (lifeSlot) return;
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
  // 快捷欄藏起來時（小遊戲中）不用替它留位置
  const r = hudEl.getBoundingClientRect();
  stage.resize(window.innerWidth, h, r.height ? h - r.top : 0);
  ctrl.fitView();
  for (const f of friends) f.ctrl.fitView();
}
window.addEventListener('resize', resize);
new ResizeObserver(resize).observe(hudEl);
// 手機轉向時（直拿⇄橫拿）iOS 的 resize 常在尺寸還沒更新前就觸發：轉完後再補幾次，讓畫面、快捷欄、泡泡都重新排
function lateResize(): void {
  for (const ms of [80, 250, 600]) setTimeout(() => window.dispatchEvent(new Event('resize')), ms);
}
window.addEventListener('orientationchange', lateResize);
screen.orientation?.addEventListener?.('change', lateResize);
window.visualViewport?.addEventListener('resize', resize);
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

// ---------- 省電：畫面更新次數 ----------
// iPhone 的螢幕一秒可以更新 120 次，每次都畫很耗電。
// 有人在操作、玩遊戲、開麥克風或鏡頭時：每秒 60 次（夠順）；
// 一陣子沒人碰：每秒 30 次；悅靈睡覺時：每秒 20 次。
let lastInputAt = performance.now();
for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel'] as const) {
  window.addEventListener(ev, () => (lastInputAt = performance.now()), { capture: true, passive: true });
}
function fpsCap(now: number): number {
  if (overlay.classList.contains('kg-on') || liveOn || talkOn || listener.on || arCam.on || now - lastInputAt < 15_000) return 60;
  return pet.asleep ? 20 : 30;
}

function frame(now: number): void {
  // 還沒到下一次該畫的時間：先跳過（留 4ms 的餘裕，避免剛好差一點點就多等一輪）
  if (now - last < 1000 / fpsCap(now) - 4) {
    requestAnimationFrame(frame);
    return;
  }
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

  // 動態模式：最近 5 秒有看到人就看著他；3 分鐘沒人就關鏡頭省電
  if (liveOn) {
    const since = performance.now() - lastPersonAt;
    ctrl.setPerson(sensor.on && since < 5000 ? personPoint() : null);
    if (sensor.on && since > 180_000) {
      sensorOff();
      hud.toast(t('live.sleep'));
    }
  }

  // 主動發言：每 15 秒檢查一次，距離上次發言超過 45 秒才說話（AI 生命模式由 AI 決定，不用這個）
  if (!lifeSlot && ctrl.awake && pet.onboarded) {
    talkIn -= dt;
    if (talkIn <= 0) {
      talkIn = 15;
      if (now - lastSpoke > 45_000 && now - lastUserAt > 20_000 && (ctrl.mode === 'idle' || ctrl.mode === 'approach' || ctrl.mode === 'wander')) {
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
  if (!lifeSlot && stage.cake && cakeWait <= 0 && pet.hunger < MAX_HUNGER - 0.5 && ['idle', 'wander', 'approach', 'observe', 'curious'].includes(ctrl.mode)) {
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
Object.assign(window, { __fairy: { pet, ctrl, stage, hud, TRAITS, sound, music, keyGame, STICKERS, stickerCanvas, babbleStats, brainDev: { answer: brainAnswer, setCloudMode: (v: boolean) => (cloudMode = v), saveBrain, loadBrain, isCloudTired }, lifeDev: { event: lifeEvent, say, state: () => ({ slot: lifeSlot, standby: lifeStandby, fails: lifeFails, busy: lifeBusy }), look: lifeLook, sight: () => lifeSight, seenAgo: () => performance.now() - lastPersonAt, live: () => liveOn } } });
