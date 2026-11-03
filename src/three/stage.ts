// 場景：鏡頭、燈光、地面影子、粒子特效與史萊姆球。

import * as THREE from 'three';
import { drawGrid, HEART, HEART_PAL, ITEM_ICONS } from '../pixel';

function spriteTex(c: HTMLCanvasElement): THREE.Texture {
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function textCanvas(text: string, color: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d')!;
  ctx.font = 'bold 26px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(20,30,70,0.8)';
  ctx.strokeText(text, 16, 17);
  ctx.fillStyle = color;
  ctx.fillText(text, 16, 17);
  return c;
}

export type ParticleKind = 'heart' | 'zzz' | 'crumb' | 'note' | 'sparkle';

interface Particle {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  life: number;
  max: number;
  gravity: number;
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 50);
  private particles: Particle[] = [];
  private tex: Record<ParticleKind, THREE.Texture[]>;
  private shadow: THREE.Mesh;
  private motes: THREE.Points;
  ball: { mesh: THREE.Mesh; vel: THREE.Vector3; life: number } | null = null;
  private ballMat: THREE.MeshStandardMaterial;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera.position.set(0, 1.45, 5.4);
    this.camera.lookAt(0, 1.0, 0);

    this.scene.add(new THREE.HemisphereLight('#e8f6ff', '#7aa0c8', 1.6));
    const sun = new THREE.DirectionalLight('#ffffff', 1.4);
    sun.position.set(2, 5, 4);
    this.scene.add(sun);

    // 柔和的圓形地面
    const floorC = document.createElement('canvas');
    floorC.width = floorC.height = 128;
    const fctx = floorC.getContext('2d')!;
    const fg = fctx.createRadialGradient(64, 64, 4, 64, 64, 64);
    fg.addColorStop(0, 'rgba(255,255,255,0.55)');
    fg.addColorStop(1, 'rgba(255,255,255,0)');
    fctx.fillStyle = fg;
    fctx.fillRect(0, 0, 128, 128);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 7),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(floorC), transparent: true, depthWrite: false }),
    );
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    // 影子
    const shC = document.createElement('canvas');
    shC.width = shC.height = 64;
    const sctx = shC.getContext('2d')!;
    const sg = sctx.createRadialGradient(32, 32, 2, 32, 32, 32);
    sg.addColorStop(0, 'rgba(20,40,90,0.45)');
    sg.addColorStop(1, 'rgba(20,40,90,0)');
    sctx.fillStyle = sg;
    sctx.fillRect(0, 0, 64, 64);
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.9, 0.9),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shC), transparent: true, depthWrite: false }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.01;
    this.scene.add(this.shadow);

    // 空氣中的光點
    const n = 40;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 5;
      arr[i * 3 + 1] = Math.random() * 3.2;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 4 - 0.5;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    this.motes = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#ffffff', size: 0.035, transparent: true, opacity: 0.7, depthWrite: false }));
    this.scene.add(this.motes);

    const heart = spriteTex(drawGrid(HEART, HEART_PAL, 4));
    const note = spriteTex(drawGrid(ITEM_ICONS.call.grid, ITEM_ICONS.call.pal, 4));
    const crumb = (col: string) => {
      const c = document.createElement('canvas');
      c.width = c.height = 4;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = col;
      ctx.fillRect(0, 0, 4, 4);
      return spriteTex(c);
    };
    const spark = spriteTex(drawGrid(['..w..', '..w..', 'wwyww', '..w..', '..w..'], { w: '#ffffff', y: '#fff6a0' }, 4));
    this.tex = {
      heart: [heart],
      note: [note],
      zzz: [spriteTex(textCanvas('Z', '#ffffff')), spriteTex(textCanvas('z', '#dfe8ff'))],
      crumb: [crumb('#e8b864'), crumb('#c48a3a'), crumb('#e0303a')],
      sparkle: [spark],
    };

    this.ballMat = new THREE.MeshStandardMaterial({
      map: spriteTex(drawGrid(['gLgg', 'gggG', 'Gggg', 'ggGg'], { g: '#6fd24a', G: '#3e9a2a', L: '#c4f5a8' })),
      roughness: 0.4,
      transparent: true,
      opacity: 0.92,
    });
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** 悅靈可以活動的範圍（依螢幕寬度調整） */
  bounds() {
    const halfW = Math.max(0.35, 5.4 * Math.tan(THREE.MathUtils.degToRad(21)) * this.camera.aspect * 0.8 - 0.3);
    return { minX: -halfW, maxX: halfW, minY: 0.45, maxY: 2.1, minZ: -1.6, maxZ: 1.0 };
  }

  setShadow(pos: THREE.Vector3): void {
    this.shadow.position.x = pos.x;
    this.shadow.position.z = pos.z;
    const s = THREE.MathUtils.clamp(1.2 - pos.y * 0.3, 0.45, 1.1);
    this.shadow.scale.setScalar(s);
  }

  spawn(kind: ParticleKind, at: THREE.Vector3, count = 1): void {
    for (let i = 0; i < count; i++) {
      const list = this.tex[kind];
      const mat = new THREE.SpriteMaterial({ map: list[Math.floor(Math.random() * list.length)], transparent: true, depthWrite: false });
      const s = new THREE.Sprite(mat);
      const size = kind === 'crumb' ? 0.05 : kind === 'zzz' ? 0.2 : kind === 'sparkle' ? 0.14 : 0.2;
      s.scale.setScalar(size);
      s.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.15, (Math.random() - 0.5) * 0.2));
      const vel =
        kind === 'crumb' ? new THREE.Vector3((Math.random() - 0.5) * 0.8, Math.random() * 0.8, Math.random() * 0.5)
        : kind === 'sparkle' ? new THREE.Vector3((Math.random() - 0.5) * 1.4, (Math.random() - 0.3) * 1.2, (Math.random() - 0.5) * 1)
        : kind === 'zzz' ? new THREE.Vector3(0.15, 0.3, 0)
        : new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.5, 0);
      const max = kind === 'zzz' ? 2.2 : kind === 'crumb' ? 0.8 : 1.3;
      this.particles.push({ sprite: s, vel, life: max, max, gravity: kind === 'crumb' ? 3 : 0 });
      this.scene.add(s);
    }
  }

  throwBall(from: THREE.Vector3, dir: THREE.Vector3): void {
    this.removeBall();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), this.ballMat);
    mesh.position.copy(from);
    this.scene.add(mesh);
    this.ball = { mesh, vel: dir.clone().multiplyScalar(5).add(new THREE.Vector3(0, 2.2, 0)), life: 9 };
  }

  removeBall(): void {
    if (!this.ball) return;
    this.scene.remove(this.ball.mesh);
    this.ball = null;
  }

  update(dt: number, t: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      p.vel.y -= p.gravity * dt;
      p.sprite.position.addScaledVector(p.vel, dt);
      p.sprite.material.opacity = Math.min(1, (p.life / p.max) * 2);
      if (p.life <= 0) {
        this.scene.remove(p.sprite);
        p.sprite.material.dispose();
        this.particles.splice(i, 1);
      }
    }
    this.motes.position.y = Math.sin(t * 0.2) * 0.1;
    this.motes.rotation.y = t * 0.02;

    const b = this.ball;
    if (b) {
      b.life -= dt;
      b.vel.y -= 6 * dt;
      b.mesh.position.addScaledVector(b.vel, dt);
      b.mesh.rotation.x += dt * 4;
      b.mesh.rotation.z += dt * 3;
      const bd = this.bounds();
      if (b.mesh.position.y < 0.08) {
        b.mesh.position.y = 0.08;
        b.vel.y = Math.abs(b.vel.y) * 0.62; // 史萊姆般地彈跳
        b.vel.x *= 0.8;
        b.vel.z *= 0.8;
        b.mesh.scale.set(1.25, 0.7, 1.25);
      }
      b.mesh.scale.lerp(new THREE.Vector3(1, 1, 1), 1 - Math.exp(-8 * dt));
      for (const [k, lo, hi] of [['x', bd.minX - 0.2, bd.maxX + 0.2], ['z', bd.minZ - 0.4, bd.maxZ + 1.2]] as const) {
        if (b.mesh.position[k] < lo || b.mesh.position[k] > hi) {
          b.mesh.position[k] = THREE.MathUtils.clamp(b.mesh.position[k], lo, hi);
          b.vel[k] *= -0.6;
        }
      }
      if (b.life <= 0) this.removeBall();
    }
    this.renderer.render(this.scene, this.camera);
  }
}
