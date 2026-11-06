// 運動場：用史萊姆球玩的四種小遊戲（籃球、足球 PK、排球、棒球）。
// 借用主畫面的 3D 場景和悅靈（悅靈照遊戲需要飛到指定位置、做動作），只多放一顆球和簡單的場地道具，
// 物理是自己算的拋物線＋旋轉造成的偏移（不用物理引擎），負擔很小；只有打開運動場時才會載入這個檔案。

import * as THREE from 'three';
import type { Lang } from '../i18n';
import type { Personality } from '../game/state';
import type { Sfx } from '../sfx';

export interface SportsHost {
  root: HTMLElement;
  scene: THREE.Scene;
  ballTexture(): THREE.Texture;
  lang(): Lang;
  personality(): Personality;
  /** 開始：悅靈停止自己行動、收起場地上的道具 */
  begin(): void;
  /** 結束：恢復原狀 */
  end(): void;
  allayTo(x: number, y: number, z: number): void;
  react(m: 'happy' | 'oops' | 'flip' | 'dance' | 'wave' | 'tickled', dur: number): void;
  allayHead(): THREE.Vector3;
  spawn(kind: 'heart' | 'note', at: THREE.Vector3, n: number): void;
  say(text: string): void;
  chirp(): void;
  sfx(e: Sfx): void;
  click(): void;
}

type GameId = 'basket' | 'soccer' | 'volley' | 'baseball';

// ---------- 文字 ----------
const L = {
  zh_tw: {
    title: '運動場',
    pick: '用史萊姆球和悅靈一起運動！',
    basket: '籃球', basketDesc: '往上滑投籃，籃框會移動',
    soccer: '足球 PK', soccerDesc: '滑動射門，悅靈當守門員',
    volley: '排球', volleyDesc: '放開手指把球打回去，不計分',
    baseball: '棒球', baseballDesc: '投球或打擊，各三個打席',
    balls: '球數', pitch: '投球（悅靈打擊）', bat: '打擊（悅靈投球）',
    start: '開始', close: '關閉', again: '再玩一次', menu: '回選單',
    basketHint: '手指往上滑投籃：滑得越長投得越遠，左右偏就往左右',
    soccerHint: '手指滑向球門射門：滑的方向和長度決定位置，畫弧線球會彎',
    volleyHint: '球飛到面前時，按住再放開把球打回去（點左邊打左邊）',
    pitchHint: '選球種 → 按住蓄力，力量條越滿越快越平 → 放開投出（按住時左右拖可以瞄準）',
    batHint: '悅靈投球後，看準時機放開手指揮棒（電腦按住滑鼠左鍵再放開）',
    score: '得分 {a}／{b}', left: '剩 {n} 球', rally: '來回 {n} 次（最佳 {b}）',
    pa: '第 {n} 打席', count: '{b} 壞 {s} 好',
    nice: '進了！', miss: '沒進…', goal: '球進了！', saved: '被悅靈擋下了！', wide: '射偏了…',
    good: '漂亮！', whiff: '沒打到…', allayMiss: '悅靈沒接到！',
    strike: '好球！', ball: '壞球', foul: '界外球', out: '出局', single: '一壘安打', double: '二壘安打', homer: '全壘打！',
    strikeout: '三振！', walk: '四壞球保送',
    fast: '直球', curve: '曲球', slider: '滑球', splitter: '指叉球',
    result: '結果', resBasket: '投進 {a}／{b} 球', resSoccer: '踢進 {a}／{b} 球', resVolley: '最多連續來回 {b} 次',
    resPitch: '悅靈 3 個打席：{r}', resBat: '你 3 個打席：{r}',
    cheerGood: ['好厲害！', '太棒了！', '耶！'], cheerBad: ['沒關係！', '再一次！', '加油！'],
  },
  ja_jp: {
    title: 'うんどうじょう',
    pick: 'スライムボールでアレイといっしょに運動しよう！',
    basket: 'バスケ', basketDesc: '上にスワイプしてシュート、ゴールが動くよ',
    soccer: 'サッカー PK', soccerDesc: 'スワイプでシュート、アレイがキーパー',
    volley: 'バレー', volleyDesc: '指をはなしてボールを打ち返そう（点数なし）',
    baseball: '野球', baseballDesc: 'ピッチングかバッティング、3 打席ずつ',
    balls: 'ボールの数', pitch: 'ピッチング（アレイが打つ）', bat: 'バッティング（アレイが投げる）',
    start: 'スタート', close: '閉じる', again: 'もう一回', menu: 'メニューへ',
    basketHint: '指を上にスワイプしてシュート：長いほど遠くへ、左右にずらすと左右へ',
    soccerHint: 'ゴールに向かってスワイプ：向きと長さで場所が決まり、カーブを描くと曲がるよ',
    volleyHint: 'ボールが目の前に来たら、おしてはなして打ち返そう（左をおすと左へ）',
    pitchHint: '球種をえらぶ → おしてためる（メーターが満タンほど速くてまっすぐ）→ はなして投げる（おしたまま左右で狙える）',
    batHint: 'アレイが投げたら、タイミングよく指をはなしてスイング（パソコンは左クリックをおしてはなす）',
    score: '得点 {a}／{b}', left: 'のこり {n} 球', rally: 'ラリー {n} 回（ベスト {b}）',
    pa: '第 {n} 打席', count: '{b} ボール {s} ストライク',
    nice: '入った！', miss: 'はずれ…', goal: 'ゴール！', saved: 'アレイが止めた！', wide: 'はずれた…',
    good: 'ナイス！', whiff: '空ぶり…', allayMiss: 'アレイがとれなかった！',
    strike: 'ストライク！', ball: 'ボール', foul: 'ファウル', out: 'アウト', single: 'ヒット', double: 'ツーベース', homer: 'ホームラン！',
    strikeout: '三振！', walk: 'フォアボール',
    fast: 'ストレート', curve: 'カーブ', slider: 'スライダー', splitter: 'フォーク',
    result: '結果', resBasket: '{a}／{b} 球シュート成功', resSoccer: '{a}／{b} 球ゴール', resVolley: 'さいこう {b} 回ラリー',
    resPitch: 'アレイの 3 打席：{r}', resBat: 'あなたの 3 打席：{r}',
    cheerGood: ['すごい！', 'やったね！', 'わーい！'], cheerBad: ['だいじょうぶ！', 'もう一回！', 'がんばれ！'],
  },
  en_us: {
    title: 'Sports Field',
    pick: 'Play sports with the slime ball and your allay!',
    basket: 'Basketball', basketDesc: 'Swipe up to shoot; the hoop moves',
    soccer: 'Soccer PK', soccerDesc: 'Swipe to shoot; the allay is the goalie',
    volley: 'Volleyball', volleyDesc: 'Release to hit the ball back (no score)',
    baseball: 'Baseball', baseballDesc: 'Pitch or bat, three at-bats each',
    balls: 'Balls', pitch: 'Pitch (allay bats)', bat: 'Bat (allay pitches)',
    start: 'Start', close: 'Close', again: 'Play again', menu: 'Menu',
    basketHint: 'Swipe up to shoot: longer swipes go farther, tilt left or right to aim',
    soccerHint: 'Swipe toward the goal: direction and length pick the spot, curve your swipe to bend it',
    volleyHint: 'When the ball reaches you, press and release to hit it back (press left to aim left)',
    pitchHint: 'Pick a pitch, hold to charge (fuller bar = faster and flatter), release to throw (drag sideways while holding to aim)',
    batHint: 'After the allay pitches, release at the right moment to swing (on a computer, hold and release the left mouse button)',
    score: 'Score {a}/{b}', left: '{n} left', rally: 'Rally {n} (best {b})',
    pa: 'At-bat {n}', count: '{b} balls {s} strikes',
    nice: 'Swish!', miss: 'Missed…', goal: 'Goal!', saved: 'Saved by the allay!', wide: 'Wide…',
    good: 'Nice!', whiff: 'Whiff…', allayMiss: 'The allay missed it!',
    strike: 'Strike!', ball: 'Ball', foul: 'Foul', out: 'Out', single: 'Single', double: 'Double', homer: 'Home run!',
    strikeout: 'Strikeout!', walk: 'Walk',
    fast: 'Fastball', curve: 'Curve', slider: 'Slider', splitter: 'Splitter',
    result: 'Result', resBasket: 'Made {a}/{b}', resSoccer: 'Scored {a}/{b}', resVolley: 'Best rally {b}',
    resPitch: "Allay's 3 at-bats: {r}", resBat: 'Your 3 at-bats: {r}',
    cheerGood: ['Amazing!', 'Great job!', 'Yay!'], cheerBad: ["It's okay!", 'Try again!', 'You got this!'],
  },
};
type Txt = (typeof L)['zh_tw'];
type TKey = { [K in keyof Txt]: Txt[K] extends string ? K : never }[keyof Txt];

const G = 7; // 重力
const R = 0.11; // 球的半徑

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  parent?.appendChild(e);
  return e;
}
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

/** 從 start 在 T 秒內飛到 target 的初速度（含重力、額外加速度） */
function launch(start: THREE.Vector3, target: THREE.Vector3, T: number, acc = new THREE.Vector3()): THREE.Vector3 {
  return new THREE.Vector3(
    (target.x - start.x) / T - 0.5 * acc.x * T,
    (target.y - start.y) / T + 0.5 * (G - acc.y) * T,
    (target.z - start.z) / T - 0.5 * acc.z * T,
  );
}

// ---------- 球 ----------
class Ball {
  readonly sprite: THREE.Sprite;
  readonly shadow: THREE.Mesh;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  /** 旋轉造成的加速度（變化球、香蕉球） */
  readonly acc = new THREE.Vector3();
  /** 這個時間之後才加上 acc（指叉球的晚下墜） */
  accAfter = 0;
  t = 0;
  active = false;
  gravity = true;

  constructor(scene: THREE.Scene, tex: THREE.Texture) {
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    this.sprite.scale.setScalar(R * 2.2);
    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(R, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    scene.add(this.sprite, this.shadow);
    this.hide();
  }

  throw(from: THREE.Vector3, vel: THREE.Vector3, acc = new THREE.Vector3(), accAfter = 0): void {
    this.pos.copy(from);
    this.vel.copy(vel);
    this.acc.copy(acc);
    this.accAfter = accAfter;
    this.t = 0;
    this.active = true;
    this.gravity = true;
    this.sprite.visible = this.shadow.visible = true;
    this.sync();
  }

  place(p: THREE.Vector3): void {
    this.pos.copy(p);
    this.vel.set(0, 0, 0);
    this.active = false;
    this.sprite.visible = this.shadow.visible = true;
    this.sync();
  }

  hide(): void {
    this.active = false;
    this.sprite.visible = this.shadow.visible = false;
  }

  step(dt: number): void {
    if (!this.active) return;
    this.t += dt;
    if (this.t >= this.accAfter) this.vel.addScaledVector(this.acc, dt);
    if (this.gravity) this.vel.y -= G * dt;
    this.pos.addScaledVector(this.vel, dt);
    this.sync();
  }

  /** 落地彈一下；回傳這一步有沒有碰到地面 */
  bounce(k = 0.55): boolean {
    if (this.pos.y >= R || this.vel.y > 0) return false;
    this.pos.y = R;
    this.vel.y = -this.vel.y * k;
    this.vel.x *= 0.8;
    this.vel.z *= 0.8;
    return true;
  }

  sync(): void {
    this.sprite.position.copy(this.pos);
    this.sprite.material.rotation += this.vel.length() * 0.02;
    this.shadow.position.set(this.pos.x, 0.012, this.pos.z);
    const s = THREE.MathUtils.clamp(1.2 - this.pos.y * 0.25, 0.4, 1.2);
    this.shadow.scale.setScalar(s);
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.sprite, this.shadow);
    this.sprite.material.dispose();
    this.shadow.geometry.dispose();
    (this.shadow.material as THREE.Material).dispose();
  }
}

// ---------- 場地道具 ----------
const mat = (color: number, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity });

function box(w: number, h: number, d: number, color: number, opacity = 1): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opacity));
}

// ---------- 每個遊戲 ----------
interface Ctx {
  host: SportsHost;
  ball: Ball;
  props: THREE.Group;
  t: Txt;
  msg(text: string, good?: boolean): void;
  status(text: string): void;
  done(summary: string): void;
  cheer(good: boolean): void;
}

interface Game {
  update(dt: number): void;
  down(x: number, y: number): void;
  move(x: number, y: number): void;
  up(x: number, y: number): void;
}

/** 手指的位置：x -1（左）~ 1（右）、y -1（下）~ 1（上），以螢幕高度為比例 */
interface Pt {
  x: number;
  y: number;
  t: number;
}

// ===== 籃球 =====
class Basketball implements Game {
  private hoop = new THREE.Vector3(0, 2.05, -1.4);
  private ring: THREE.Mesh;
  private board: THREE.Group;
  private made = 0;
  private shot = 0;
  private flying = false;
  private scoredThis = false;
  private wait = 0;
  private start: Pt | null = null;
  private time = 0;
  private readonly from = new THREE.Vector3(0, 0.95, 3.2);

  constructor(private c: Ctx, private total: number) {
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.02, 8, 24), mat(0xff7a1a));
    this.ring.rotation.x = Math.PI / 2;
    this.board = new THREE.Group();
    const b = box(1.0, 0.65, 0.03, 0xffffff, 0.92);
    b.position.set(0, 0.25, -0.3);
    const sq = box(0.36, 0.26, 0.035, 0xff4444);
    sq.position.set(0, 0.16, -0.29);
    this.board.add(b, sq);
    c.props.add(this.ring, this.board);
    c.host.allayTo(0.8, 1.3, -1.0);
    this.next();
  }

  private next(): void {
    if (this.shot >= this.total) {
      this.c.ball.hide();
      this.c.done(this.c.t.resBasket.replace('{a}', String(this.made)).replace('{b}', String(this.total)));
      return;
    }
    this.flying = false;
    this.scoredThis = false;
    this.c.ball.place(this.from);
    this.c.status(`${this.c.t.score.replace('{a}', String(this.made)).replace('{b}', String(this.shot))}・${this.c.t.left.replace('{n}', String(this.total - this.shot))}`);
  }

  update(dt: number): void {
    this.time += dt;
    // 籃框越投進越會動
    const amp = this.made < 2 ? 0 : Math.min(1.1, 0.35 + (this.made - 2) * 0.12);
    const speed = 0.8 + this.made * 0.07;
    this.hoop.x = amp * Math.sin(this.time * speed);
    this.ring.position.copy(this.hoop);
    this.board.position.copy(this.hoop);
    this.c.host.allayTo(THREE.MathUtils.clamp(this.hoop.x + (this.hoop.x > 0 ? -0.8 : 0.8), -0.8, 0.8), 1.3, -1.0);
    const ball = this.c.ball;
    if (!this.flying) return;
    const prevY = ball.pos.y;
    ball.step(dt);
    // 籃板
    const boardZ = this.hoop.z - 0.3;
    if (ball.pos.z < boardZ + R && ball.vel.z < 0 && Math.abs(ball.pos.x - this.hoop.x) < 0.5 && ball.pos.y > this.hoop.y - 0.1 && ball.pos.y < this.hoop.y + 0.6) {
      ball.pos.z = boardZ + R;
      ball.vel.z = -ball.vel.z * 0.45;
      this.c.host.sfx('wood');
    }
    // 穿過籃框的高度（往下掉時）
    if (!this.scoredThis && prevY > this.hoop.y && ball.pos.y <= this.hoop.y) {
      const d = Math.hypot(ball.pos.x - this.hoop.x, ball.pos.z - this.hoop.z);
      if (d < 0.24 - R * 0.5) {
        this.scoredThis = true;
        this.made++;
        ball.vel.multiplyScalar(0.3);
        this.c.msg(this.c.t.nice, true);
        this.c.cheer(true);
        this.c.host.sfx('levelup');
      } else if (d < 0.24 + R) {
        // 打到籃框：彈開
        ball.vel.y = Math.abs(ball.vel.y) * 0.4;
        ball.vel.x += (ball.pos.x - this.hoop.x) * 4;
        ball.vel.z += (ball.pos.z - this.hoop.z) * 4;
        this.c.host.sfx('slime');
      }
    }
    if (ball.bounce()) this.c.host.sfx('slime');
    this.wait += dt;
    if (this.wait > 2.6 || ball.pos.z > 4.5) {
      if (!this.scoredThis) {
        this.c.msg(this.c.t.miss);
        this.c.cheer(false);
      }
      this.next();
    }
  }

  down(x: number, y: number): void {
    if (this.flying) return;
    this.start = { x, y, t: performance.now() };
  }
  move(): void {}
  up(x: number, y: number): void {
    const s = this.start;
    this.start = null;
    if (!s || this.flying || this.shot >= this.total) return;
    const dy = y - s.y;
    const dx = x - s.x;
    if (dy < 0.08) return;
    // 滑得越長投得越遠：滑螢幕高度的 37% 左右剛好到籃框
    const from = this.from.clone();
    const dist = 2.4 + dy * 6.2;
    const target = new THREE.Vector3(from.x + dx * 3.2, this.hoop.y, from.z - dist);
    this.c.ball.throw(from, launch(from, target, 0.95));
    this.flying = true;
    this.wait = 0;
    this.shot++;
    this.c.host.sfx('throw');
  }
}

// ===== 足球 PK =====
const KEEPER: Record<Personality, { delay: number; guess: number }> = {
  brave: { delay: 0.12, guess: 0.62 },
  guardian: { delay: 0.17, guess: 0.66 },
  playful: { delay: 0.2, guess: 0.5 },
  cautious: { delay: 0.3, guess: 0.45 },
};

class Soccer implements Game {
  private readonly goalZ = -2.2;
  private readonly from = new THREE.Vector3(0, R, 2.0);
  private goals = 0;
  private shot = 0;
  private flying = false;
  private result: 'goal' | 'saved' | 'wide' | null = null;
  private wait = 0;
  private path: Pt[] = [];
  private dive: { at: number; to: THREE.Vector3; save: boolean } | null = null;

  constructor(private c: Ctx, private total: number) {
    const white = 0xffffff;
    const left = box(0.06, 1.1, 0.06, white);
    left.position.set(-1.2, 0.55, this.goalZ);
    const right = left.clone();
    right.position.x = 1.2;
    const bar = box(2.46, 0.06, 0.06, white);
    bar.position.set(0, 1.1, this.goalZ);
    const net = box(2.4, 1.1, 0.02, white, 0.18);
    net.position.set(0, 0.55, this.goalZ - 0.35);
    c.props.add(left, right, bar, net);
    this.next();
  }

  private keeperHome(): void {
    this.c.host.allayTo(0, 0.55, this.goalZ + 0.25);
  }

  private next(): void {
    if (this.shot >= this.total) {
      this.c.ball.hide();
      this.c.done(this.c.t.resSoccer.replace('{a}', String(this.goals)).replace('{b}', String(this.total)));
      return;
    }
    this.flying = false;
    this.result = null;
    this.dive = null;
    this.c.ball.place(this.from);
    this.keeperHome();
    this.c.status(`${this.c.t.score.replace('{a}', String(this.goals)).replace('{b}', String(this.shot))}・${this.c.t.left.replace('{n}', String(this.total - this.shot))}`);
  }

  update(dt: number): void {
    const ball = this.c.ball;
    if (!this.flying) return;
    this.wait += dt;
    if (this.dive && this.wait >= this.dive.at) {
      this.c.host.allayTo(this.dive.to.x, this.dive.to.y, this.goalZ + 0.25);
      this.dive.at = Infinity;
    }
    const prevZ = ball.pos.z;
    ball.step(dt);
    if (ball.bounce(0.5)) this.c.host.sfx('slime');
    // 到守門員的位置：撲到就擋下
    if (!this.result && prevZ > this.goalZ + 0.25 && ball.pos.z <= this.goalZ + 0.25 && this.dive?.save) {
      this.result = 'saved';
      ball.vel.set(rnd(-1.5, 1.5), 2.2, 3.2);
      ball.acc.set(0, 0, 0);
      this.c.msg(this.c.t.saved);
      this.c.host.react('happy', 1.2);
      this.c.host.sfx('slime');
    }
    // 過了球門線
    if (!this.result && prevZ > this.goalZ && ball.pos.z <= this.goalZ) {
      const inGoal = Math.abs(ball.pos.x) < 1.2 - R && ball.pos.y < 1.1 - R;
      this.result = inGoal ? 'goal' : 'wide';
      if (inGoal) {
        this.goals++;
        ball.vel.multiplyScalar(0.15);
        this.c.msg(this.c.t.goal, true);
        this.c.host.react('oops', 1.4);
        this.c.host.sfx('levelup');
        this.c.cheer(true);
      } else {
        this.c.msg(this.c.t.wide);
        this.c.cheer(false);
      }
    }
    if (this.wait > 2.4) this.next();
  }

  down(x: number, y: number): void {
    if (this.flying) return;
    this.path = [{ x, y, t: performance.now() }];
  }
  move(x: number, y: number): void {
    if (this.path.length) this.path.push({ x, y, t: performance.now() });
  }
  up(x: number, y: number): void {
    const p = this.path;
    this.path = [];
    if (!p.length || this.flying || this.shot >= this.total) return;
    p.push({ x, y, t: performance.now() });
    const s = p[0];
    const e = p[p.length - 1];
    const len = Math.hypot(e.x - s.x, e.y - s.y);
    if (len < 0.08 || e.y <= s.y) return;
    // 方向與長度 → 球門上的位置；滑得快球就快
    const secs = Math.max(0.05, (e.t - s.t) / 1000);
    const speed = THREE.MathUtils.clamp(len / secs, 0.6, 4);
    const T = THREE.MathUtils.clamp(0.95 - speed * 0.12, 0.45, 0.9);
    const tx = THREE.MathUtils.clamp((e.x - s.x) * 3.0, -1.9, 1.9);
    const ty = THREE.MathUtils.clamp((e.y - s.y - 0.15) * 1.3, R, 1.6);
    // 畫弧線：中間點偏離直線越多，球彎越多（香蕉球）
    const mid = p[Math.floor(p.length / 2)];
    const bend = THREE.MathUtils.clamp((mid.x - (s.x + e.x) / 2) * -14, -6, 6);
    const acc = new THREE.Vector3(bend, 0, 0);
    const target = new THREE.Vector3(tx, ty, this.goalZ);
    this.c.ball.throw(this.from, launch(this.from, target, T, acc), acc);
    this.flying = true;
    this.wait = 0;
    this.shot++;
    this.c.host.sfx('throw');
    // 守門員：反應時間、猜方向（照個性）
    const k = KEEPER[this.c.host.personality()];
    const right = Math.random() < k.guess;
    const aim = new THREE.Vector3(right ? tx : -tx * 0.7, THREE.MathUtils.clamp(ty, 0.35, 0.9), 0);
    aim.x += rnd(-0.25, 0.25);
    const reach = 0.5;
    const travel = Math.abs(aim.x) / 3.2;
    const save = right && Math.abs(aim.x - tx) < reach && Math.abs(aim.y - ty) < reach + 0.2 && k.delay + travel < T * 0.95 && Math.abs(tx) < 1.2 && ty < 1.1;
    this.dive = { at: k.delay, to: aim, save };
  }
}

// ===== 排球 =====
class Volleyball implements Game {
  private rally = 0;
  private best = 0;
  private toPlayer = false;
  private allayX = 0;
  private hitDone = false;
  private wait = 0;
  private serveIn = 1;
  private hard = 0;

  constructor(private c: Ctx) {
    const net = box(3.2, 0.5, 0.02, 0xffffff, 0.55);
    net.position.set(0, 1.35, 0);
    const top = box(3.2, 0.04, 0.04, 0xffffff);
    top.position.set(0, 1.6, 0);
    const p1 = box(0.05, 1.6, 0.05, 0xcccccc);
    p1.position.set(-1.62, 0.8, 0);
    const p2 = p1.clone();
    p2.position.x = 1.62;
    c.props.add(net, top, p1, p2);
    c.host.allayTo(0, 1.2, -1.8);
    this.status();
  }

  private status(): void {
    this.c.status(this.c.t.rally.replace('{n}', String(this.rally)).replace('{b}', String(this.best)));
  }

  /** 悅靈把球打過來 */
  private allayHit(fromX: number): void {
    const from = new THREE.Vector3(fromX, 1.75, -1.7);
    const target = new THREE.Vector3(rnd(-0.9, 0.9), 0.95, 2.6);
    const T = Math.max(0.95, 1.45 - this.hard * 0.04);
    this.c.ball.throw(from, launch(from, target, T));
    this.toPlayer = true;
    this.hitDone = false;
    this.c.host.react('happy', 0.5);
    this.c.host.sfx('slime');
  }

  update(dt: number): void {
    const ball = this.c.ball;
    if (this.serveIn > 0) {
      this.serveIn -= dt;
      if (this.serveIn <= 0) this.allayHit(this.allayX);
      return;
    }
    ball.step(dt);
    // 悅靈跟著球移動
    if (!this.toPlayer) {
      this.allayX += THREE.MathUtils.clamp(ball.pos.x - this.allayX, -2 * dt, 2 * dt);
      this.c.host.allayTo(this.allayX, 1.2, -1.8);
      // 球回到悅靈那邊、掉到打得到的高度：打回來（離太遠就接不到）
      if (ball.pos.z < -1.4 && ball.vel.y < 0 && ball.pos.y < 1.9) {
        if (Math.abs(ball.pos.x - this.allayX) < 0.85) {
          this.rally++;
          this.best = Math.max(this.best, this.rally);
          this.hard++;
          this.status();
          this.allayHit(ball.pos.x);
        } else {
          this.c.msg(this.c.t.allayMiss, true);
          this.c.host.react('oops', 1.2);
          this.toPlayer = true;
          this.hitDone = true;
          this.wait = 0;
        }
      }
    }
    if (ball.bounce(0.4) && !this.hitDone) {
      // 落在自己這邊：這回合結束
      if (ball.pos.z > 0) {
        this.c.msg(this.c.t.whiff);
        this.c.cheer(false);
        this.hitDone = true;
        this.wait = 0;
      }
    }
    if (this.hitDone) {
      this.wait += dt;
      if (this.wait > 1.4) {
        this.rally = 0;
        this.hard = 0;
        this.status();
        this.serveIn = 0.6;
        this.toPlayer = false;
        this.hitDone = false;
      }
    }
  }

  down(): void {}
  move(): void {}
  up(x: number): void {
    const ball = this.c.ball;
    if (!ball.active || !this.toPlayer || this.hitDone) return;
    // 打得到的範圍：球在面前、高度適中
    const inReach = ball.pos.z > 1.5 && ball.pos.z < 3.3 && ball.pos.y > 0.35 && ball.pos.y < 2.0;
    if (!inReach) return;
    const from = ball.pos.clone();
    const target = new THREE.Vector3(THREE.MathUtils.clamp(x * 1.6, -1.4, 1.4), 1.4, -1.8);
    ball.throw(from, launch(from, target, 1.15));
    this.toPlayer = false;
    this.c.host.sfx('slime');
    if (Math.abs(from.y - 1.1) < 0.3) this.c.msg(this.c.t.good, true);
  }
}

// ===== 棒球 =====
type Pitch = 'fast' | 'curve' | 'slider' | 'splitter';
const BREAK: Record<Pitch, { acc: [number, number]; after: number; hard: number }> = {
  fast: { acc: [0, 1.2], after: 0, hard: 0 },
  curve: { acc: [-1.4, -4.2], after: 0, hard: 0.6 },
  slider: { acc: [-4.4, -0.8], after: 0, hard: 0.7 },
  splitter: { acc: [0, -9], after: 0.55, hard: 0.8 },
};

class Baseball implements Game {
  private pa = 1;
  private balls = 0;
  private strikes = 0;
  private results: string[] = [];
  private phase: 'ready' | 'charge' | 'flying' | 'after' = 'ready';
  private pitch: Pitch = 'fast';
  private charge = 0;
  private chargeT = 0;
  private aimX = 0;
  private downX = 0;
  private wait = 0;
  private plateZ: number;
  private zone: THREE.Mesh;
  private flightT = 0;
  private swingAt = -1;
  private decided = false;
  private meter: HTMLDivElement | null = null;
  private meterFill: HTMLDivElement | null = null;

  constructor(private c: Ctx, private mode: 'pitch' | 'bat', controls: HTMLElement) {
    this.plateZ = mode === 'pitch' ? -1.8 : 2.3;
    // 好球帶（半透明框）與本壘板
    this.zone = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false }));
    this.zone.position.set(0, 0.75, this.plateZ);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(0.56, 0.6)), new THREE.LineBasicMaterial({ color: 0xffffff }));
    edges.position.copy(this.zone.position);
    const plate = new THREE.Mesh(new THREE.CircleGeometry(0.22, 5), mat(0xffffff));
    plate.rotation.x = -Math.PI / 2;
    plate.position.set(0, 0.012, this.plateZ);
    c.props.add(this.zone, edges, plate);
    if (mode === 'pitch') {
      c.host.allayTo(-0.6, 0.8, this.plateZ - 0.1);
      const row = el('div', 'btnrow sp-pitches', controls);
      (['fast', 'curve', 'slider', 'splitter'] as Pitch[]).forEach((p) => {
        const b = el('button', 'btn small' + (p === this.pitch ? ' on' : ''), row);
        b.textContent = this.c.t[p];
        b.addEventListener('pointerdown', (e) => e.stopPropagation());
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          this.pitch = p;
          row.querySelectorAll('.btn').forEach((x) => x.classList.toggle('on', x === b));
          this.c.host.click();
        });
      });
      this.meter = el('div', 'sp-meter', controls);
      this.meterFill = el('div', 'sp-meter-fill', this.meter);
    } else c.host.allayTo(0, 1.0, -2.2);
    this.status();
    if (mode === 'bat') this.wait = -1.2;
  }

  private status(): void {
    this.c.status(`${this.c.t.pa.replace('{n}', String(this.pa))}・${this.c.t.count.replace('{b}', String(this.balls)).replace('{s}', String(this.strikes))}`);
  }

  private endPa(text: string, good: boolean): void {
    this.results.push(text);
    this.c.msg(text, good);
    this.balls = 0;
    this.strikes = 0;
    this.pa++;
    if (this.pa > 3) {
      this.phase = 'after';
      this.wait = -2;
      return;
    }
    this.status();
  }

  private call(kind: TKey, good: boolean): void {
    const t = this.c.t;
    if (kind === 'strike') {
      this.strikes++;
      if (this.strikes >= 3) return this.endPa(t.strikeout, this.mode === 'pitch');
    } else if (kind === 'ball') {
      this.balls++;
      if (this.balls >= 4) return this.endPa(t.walk, this.mode === 'bat');
    } else if (kind === 'foul') {
      if (this.strikes < 2) this.strikes++;
    } else return this.endPa(t[kind] as string, good);
    this.c.msg(t[kind] as string, good);
    this.status();
  }

  update(dt: number): void {
    const ball = this.c.ball;
    if (this.phase === 'after') {
      this.wait += dt;
      ball.step(dt);
      if (this.wait > 0) {
        if (this.pa > 3) {
          ball.hide();
          const r = this.results.join('、');
          this.c.done((this.mode === 'pitch' ? this.c.t.resPitch : this.c.t.resBat).replace('{r}', r));
          this.phase = 'ready';
          this.pa = -99;
          return;
        }
        this.phase = 'ready';
        this.wait = this.mode === 'bat' ? -1 : 0;
      }
      return;
    }
    if (this.mode === 'pitch') {
      if (this.phase === 'ready') ball.place(new THREE.Vector3(0, 1.1, 2.4));
      if (this.phase === 'charge') {
        // 力量條來回跑（1.2 秒一趟）
        this.chargeT += dt;
        this.charge = 1 - Math.abs(((this.chargeT / 0.6) % 2) - 1);
        if (this.meterFill) this.meterFill.style.width = `${Math.round(this.charge * 100)}%`;
      }
    } else if (this.phase === 'ready') {
      this.wait += dt;
      if (this.wait > 0 && this.pa <= 3) this.allayPitch();
    }
    if (this.phase !== 'flying') return;
    const prevZ = ball.pos.z;
    ball.step(dt);
    this.flightT += dt;
    if (this.mode === 'pitch') this.pitchFlight(prevZ);
    else this.batFlight(prevZ);
  }

  // ----- 你投球、悅靈打擊 -----
  private pitchFlight(prevZ: number): void {
    const ball = this.c.ball;
    if (!this.decided && prevZ > this.plateZ && ball.pos.z <= this.plateZ) {
      this.decided = true;
      const inZone = Math.abs(ball.pos.x) < 0.28 && ball.pos.y > 0.45 && ball.pos.y < 1.05;
      const b = BREAK[this.pitch];
      const power = this.charge;
      const p = this.c.host.personality();
      const eye = p === 'cautious' ? 0.15 : p === 'brave' ? -0.1 : 0;
      const swing = Math.random() < (inZone ? 0.78 : 0.32 - eye);
      this.c.host.react('flip', 0.6);
      if (!swing) {
        this.call(inZone ? 'strike' : 'ball', inZone);
        ball.vel.multiplyScalar(0.2);
      } else {
        const edge = Math.abs(ball.pos.x) > 0.18 || Math.abs(ball.pos.y - 0.75) > 0.22 ? 0.12 : 0;
        const contact = Math.random() < 0.72 - power * 0.32 - b.hard * 0.18 - edge - (inZone ? 0 : 0.25);
        if (!contact) {
          this.call('strike', true);
          ball.vel.multiplyScalar(0.2);
        } else {
          const r = Math.random() + power * 0.15;
          const kind: TKey = r < 0.36 ? 'foul' : r < 0.72 ? 'out' : r < 0.9 ? 'single' : r < 0.97 ? 'double' : 'homer';
          this.c.host.sfx('wood');
          ball.vel.set(rnd(-3, 3), rnd(2, 6), rnd(4, 9));
          ball.acc.set(0, 0, 0);
          this.call(kind, kind === 'foul' || kind === 'out');
          if (kind === 'homer' || kind === 'double' || kind === 'single') this.c.host.react('dance', 1.6);
        }
      }
      this.phase = 'after';
      this.wait = -1.2;
    }
  }

  // ----- 悅靈投球、你打擊 -----
  private allayPitch(): void {
    const from = new THREE.Vector3(0, 1.2, -2.0);
    const p = pick(['fast', 'fast', 'curve', 'slider', 'splitter'] as Pitch[]);
    const outside = Math.random() < 0.3;
    const target = new THREE.Vector3(outside ? pick([-0.55, 0.55]) : rnd(-0.18, 0.18), outside ? rnd(0.3, 1.25) : rnd(0.55, 0.95), this.plateZ);
    const T = rnd(0.95, 1.35) * (p === 'fast' ? 0.85 : 1);
    const b = BREAK[p];
    // 從這邊看，左右相反
    const acc = new THREE.Vector3(-b.acc[0] * 0.6, b.acc[1] * 0.6, 0);
    this.c.ball.throw(from, launch(from, target, T, b.after ? new THREE.Vector3() : acc), acc, b.after * T);
    this.flightT = 0;
    this.phase = 'flying';
    this.decided = false;
    this.swingAt = -1;
    this.c.host.react('happy', 0.5);
    this.c.host.sfx('throw');
  }

  private batFlight(prevZ: number): void {
    const ball = this.c.ball;
    if (this.decided) return;
    const arrived = prevZ < this.plateZ && ball.pos.z >= this.plateZ;
    if (this.swingAt >= 0 || arrived) {
      this.decided = true;
      const inZone = Math.abs(ball.pos.x) < 0.3 && ball.pos.y > 0.42 && ball.pos.y < 1.08;
      if (this.swingAt < 0) {
        this.call(inZone ? 'strike' : 'ball', !inZone);
      } else {
        // 放開手指的時間和球到本壘的時間差多少
        const toPlate = (this.plateZ - ball.pos.z) / Math.max(0.5, ball.vel.z);
        const err = Math.abs(toPlate);
        const near = Math.abs(ball.pos.x) < 0.42 && ball.pos.y > 0.3 && ball.pos.y < 1.25;
        let kind: TKey = 'strike';
        if (near) kind = err < 0.03 ? 'homer' : err < 0.06 ? 'double' : err < 0.1 ? 'single' : err < 0.15 ? 'foul' : 'strike';
        if (kind === 'strike') {
          this.c.msg(this.c.t.whiff);
          this.call('strike', false);
        } else {
          this.c.host.sfx('wood');
          ball.vel.set(rnd(-2, 2), rnd(3, 7) + (kind === 'homer' ? 3 : 0), -rnd(6, 11));
          ball.acc.set(0, 0, 0);
          this.call(kind, kind !== 'foul');
          if (kind !== 'foul') this.c.cheer(true);
        }
      }
      this.phase = 'after';
      this.wait = -1.4;
    }
  }

  down(x: number): void {
    if (this.mode === 'pitch' && this.phase === 'ready' && this.pa <= 3) {
      this.phase = 'charge';
      this.chargeT = 0;
      this.downX = x;
      this.aimX = 0;
    }
  }
  move(x: number): void {
    if (this.phase === 'charge') this.aimX = THREE.MathUtils.clamp((x - this.downX) * 1.2, -0.5, 0.5);
  }
  up(): void {
    if (this.mode === 'bat') {
      if (this.phase === 'flying' && !this.decided) {
        this.swingAt = this.flightT;
        this.c.host.sfx('throw');
      }
      return;
    }
    if (this.phase !== 'charge') return;
    // 力量越接近滿格：越快、越平
    const power = this.charge;
    const from = new THREE.Vector3(0, 1.1, 2.4);
    const target = new THREE.Vector3(this.aimX, 0.75, this.plateZ);
    const T = 0.95 - power * 0.4;
    const b = BREAK[this.pitch];
    const acc = new THREE.Vector3(b.acc[0], b.acc[1], 0);
    this.c.ball.throw(from, launch(from, target, T, b.after ? new THREE.Vector3() : acc), acc, b.after * T);
    this.phase = 'flying';
    this.decided = false;
    this.flightT = 0;
    if (this.meterFill) this.meterFill.style.width = '0%';
    this.c.host.sfx('throw');
  }
}

// ---------- 運動場（選單、遊戲畫面） ----------
export class SportsField {
  private layer: HTMLDivElement | null = null;
  private game: Game | null = null;
  private ball: Ball | null = null;
  private props: THREE.Group | null = null;
  private raf = 0;
  private last = 0;
  private msgTimer = 0;

  constructor(private host: SportsHost) {}

  private get t(): Txt {
    return L[this.host.lang()];
  }

  /** 運動場的選單 */
  open(): void {
    const t = this.t;
    const back = el('div', 'modal-back', this.host.root);
    const box = el('div', 'modal kgmenu', back);
    el('h2', '', box).textContent = t.title;
    el('div', 'info', box).textContent = t.pick;
    const list = el('div', 'kglist', box);
    const games: [GameId, string, string][] = [
      ['basket', t.basket, t.basketDesc],
      ['soccer', t.soccer, t.soccerDesc],
      ['volley', t.volley, t.volleyDesc],
      ['baseball', t.baseball, t.baseballDesc],
    ];
    for (const [id, name, desc] of games) {
      const b = el('button', 'btn kggame', list);
      el('span', 'kgname', b).textContent = name;
      el('span', 'kgdesc', b).textContent = desc;
      b.addEventListener('click', () => {
        this.host.click();
        back.remove();
        this.options(id);
      });
    }
    const close = el('button', 'btn', box);
    close.textContent = t.close;
    close.addEventListener('click', () => {
      this.host.click();
      back.remove();
    });
  }

  /** 選球數（籃球、足球）或投球／打擊（棒球） */
  private options(id: GameId): void {
    if (id === 'volley') return this.start(id, 0);
    const t = this.t;
    const back = el('div', 'modal-back', this.host.root);
    const box = el('div', 'modal kgmenu', back);
    el('h2', '', box).textContent = t[id];
    el('div', 'info', box).textContent = id === 'baseball' ? '' : t.balls;
    const row = el('div', 'btnrow', box);
    const choices: [string, number][] = id === 'baseball' ? [[t.pitch, 0], [t.bat, 1]] : [['10', 10], ['20', 20], ['30', 30]];
    for (const [label, n] of choices) {
      const b = el('button', 'btn', row);
      b.textContent = label;
      b.addEventListener('click', () => {
        this.host.click();
        back.remove();
        this.start(id, n);
      });
    }
    const close = el('button', 'btn', box);
    close.textContent = t.menu;
    close.addEventListener('click', () => {
      this.host.click();
      back.remove();
      this.open();
    });
  }

  private start(id: GameId, n: number): void {
    this.stop();
    const t = this.t;
    this.host.begin();
    const layer = el('div', 'kg sp', this.host.root);
    this.layer = layer;
    this.host.root.classList.add('kg-on');
    const top = el('div', 'kg-top', layer);
    const exit = el('button', 'btn kg-exit', top);
    exit.textContent = '✕';
    exit.addEventListener('pointerdown', (e) => e.stopPropagation());
    exit.addEventListener('click', (e) => {
      e.stopPropagation();
      this.host.click();
      this.stop();
    });
    const info = el('div', 'kg-info', top);
    el('div', 'kg-song', info).textContent = id === 'baseball' ? `${t.baseball}・${n ? t.bat : t.pitch}` : t[id];
    const status = el('div', 'sp-status', info);
    const msg = el('div', 'sp-msg', layer);
    const bottom = el('div', 'sp-bottom', layer);
    const controls = el('div', 'sp-controls', bottom);
    el('div', 'sp-hint', bottom).textContent =
      id === 'basket' ? t.basketHint : id === 'soccer' ? t.soccerHint : id === 'volley' ? t.volleyHint : n ? t.batHint : t.pitchHint;

    this.props = new THREE.Group();
    this.host.scene.add(this.props);
    this.ball = new Ball(this.host.scene, this.host.ballTexture());
    const ctx: Ctx = {
      host: this.host,
      ball: this.ball,
      props: this.props,
      t,
      msg: (text, good = false) => {
        msg.textContent = text;
        msg.classList.toggle('good', good);
        msg.classList.add('show');
        clearTimeout(this.msgTimer);
        this.msgTimer = window.setTimeout(() => msg.classList.remove('show'), 1300);
      },
      status: (text) => (status.textContent = text),
      done: (summary) => this.finish(id, n, summary),
      cheer: (good) => {
        if (Math.random() < 0.5) this.host.say(pick(good ? t.cheerGood : t.cheerBad));
        if (good) this.host.spawn('heart', this.host.allayHead(), 2);
        this.host.chirp();
      },
    };
    this.game =
      id === 'basket' ? new Basketball(ctx, n) : id === 'soccer' ? new Soccer(ctx, n) : id === 'volley' ? new Volleyball(ctx) : new Baseball(ctx, n ? 'bat' : 'pitch', controls);

    // 手指（滑鼠左鍵）：位置換成以螢幕高度為比例的座標
    const pt = (e: PointerEvent): [number, number] => {
      const h = window.innerHeight;
      return [(e.clientX - window.innerWidth / 2) / (h / 2), -(e.clientY - h / 2) / (h / 2)];
    };
    let pressed = false;
    layer.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      pressed = true;
      layer.setPointerCapture(e.pointerId);
      this.game?.down(...pt(e));
    });
    layer.addEventListener('pointermove', (e) => {
      if (pressed) this.game?.move(...pt(e));
    });
    const up = (e: PointerEvent) => {
      if (!pressed) return;
      pressed = false;
      this.game?.up(...pt(e));
    };
    layer.addEventListener('pointerup', up);
    layer.addEventListener('pointercancel', up);

    this.last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.game?.update(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private finish(id: GameId, n: number, summary: string): void {
    const t = this.t;
    this.host.react('dance', 2.5);
    this.host.spawn('heart', this.host.allayHead(), 5);
    this.host.sfx('levelup');
    const back = el('div', 'modal-back', this.host.root);
    const box = el('div', 'modal kgmenu', back);
    el('h2', '', box).textContent = t.result;
    el('div', 'info sp-result', box).textContent = summary;
    const row = el('div', 'btnrow', box);
    const again = el('button', 'btn', row);
    again.textContent = t.again;
    again.addEventListener('click', () => {
      this.host.click();
      back.remove();
      this.start(id, n);
    });
    const menu = el('button', 'btn', row);
    menu.textContent = t.menu;
    menu.addEventListener('click', () => {
      this.host.click();
      back.remove();
      this.stop();
      this.open();
    });
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.game = null;
    if (this.ball) this.ball.dispose(this.host.scene);
    this.ball = null;
    if (this.props) {
      this.host.scene.remove(this.props);
      this.props.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mt = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mt)) mt.forEach((x) => x.dispose());
        else mt?.dispose();
      });
    }
    this.props = null;
    if (this.layer) {
      this.layer.remove();
      this.layer = null;
      this.host.root.classList.remove('kg-on');
      this.host.end();
    }
  }
}
