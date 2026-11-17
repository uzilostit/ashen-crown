import * as THREE from "three";
import type { PaperKit } from "./paper";
import { cloudTexture } from "./paper";
import { ARENA_APOTHEM, ARENA_R, clamp, damp, mulberry32, terrainY, wedgeCorners, wedgeCentre, wedgeDistance } from "./util";

/* ---------- layered paper flame ---------- */
export interface Flame { group: THREE.Group; update(t: number, seed?: number): void }
export function createFlame(scale = 1): Flame {
  const group = new THREE.Group();
  const layers: THREE.Mesh[] = [];
  const spec = [["#ff6a1c", 1.0, 1.0], ["#ffa03a", 0.74, 0.86], ["#ffd36e", 0.5, 0.7], ["#fff4cf", 0.28, 0.5]] as const;
  spec.forEach(([c, w, h], i) => {
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.9 * w, 3 * h, 5, 1), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.5 + i * 0.3, roughness: 1, flatShading: true }));
    m.position.y = 1.5 * h + 0.05 * i;
    m.rotation.y = i * 0.7;
    layers.push(m);
    group.add(m);
  });
  group.scale.setScalar(scale);
  return {
    group,
    update(t, seed = 0) {
      layers.forEach((m, i) => {
        const f = 1 + Math.sin(t * (7 + i * 2.3) + seed + i) * 0.12 + Math.sin(t * 13 + seed * 2) * 0.06;
        m.scale.set(1 + Math.sin(t * 9 + i + seed) * 0.08, f, 1 + Math.cos(t * 8 + i + seed) * 0.08);
        m.rotation.y += 0.01 * (i + 1);
        m.rotation.z = Math.sin(t * 3 + i + seed) * 0.05;
      });
    },
  };
}

/* ---------- drifting fog sheets ---------- */
export class FogSheets {
  readonly mesh: THREE.InstancedMesh;
  private base: { x: number; y: number; z: number; s: number; sp: number; ph: number }[] = [];
  private mat: THREE.MeshBasicMaterial;
  private dummy = new THREE.Object3D();
  constructor(tex: THREE.Texture, count: number, color: string, private area: (rnd: () => number) => [number, number], yMin: number, yMax: number, size: number, seed: number) {
    this.mat = new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide });
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(geo, this.mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    const rnd = mulberry32(seed);
    for (let i = 0; i < count; i++) {
      const [x, z] = this.area(rnd);
      this.base.push({ x, z, y: yMin + rnd() * (yMax - yMin), s: size * (0.7 + rnd() * 0.8), sp: 0.3 + rnd() * 0.7, ph: rnd() * 6.28 });
    }
  }
  setStyle(color: THREE.ColorRepresentation, opacity: number) {
    this.mat.color.set(color);
    this.mat.opacity = opacity;
  }
  setVisible(n: number) {
    this.mesh.count = Math.min(this.base.length, Math.max(0, n));
  }
  update(t: number) {
    this.base.forEach((b, i) => {
      this.dummy.position.set(b.x + Math.sin(t * 0.07 * b.sp + b.ph) * 6, b.y + Math.sin(t * 0.2 + b.ph) * 0.5, b.z + Math.cos(t * 0.06 * b.sp + b.ph) * 6);
      this.dummy.rotation.set(0, t * 0.02 * b.sp + b.ph, 0);
      this.dummy.scale.set(b.s, 1, b.s);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/* ---------- weather particles (paper scraps) ---------- */
export type WeatherKind = "spores" | "ash" | "needles" | "salt" | "snow" | "petals";
const WEATHER: Record<WeatherKind, { color: string; size: number; fall: number; drift: number; sway: number }> = {
  spores: { color: "#d8e08a", size: 0.55, fall: -0.25, drift: 0.4, sway: 1.2 },
  ash: { color: "#cfc7bd", size: 0.5, fall: -0.9, drift: 1.2, sway: 1.0 },
  needles: { color: "#7fa56c", size: 0.5, fall: 1.1, drift: 0.8, sway: 1.5 },
  salt: { color: "#fff8e6", size: 0.42, fall: 0.2, drift: 7, sway: 0.5 },
  snow: { color: "#ffffff", size: 0.65, fall: 1.6, drift: 0.8, sway: 1.2 },
  petals: { color: "#f2a3b2", size: 0.75, fall: 1.0, drift: 1.0, sway: 2.2 },
};
export class Weather {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private kind: WeatherKind = "needles";
  private mat: THREE.PointsMaterial;
  private max: number;
  constructor(max = 900) {
    this.max = max;
    const c = document.createElement("canvas");
    c.width = c.height = 16;
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff";
    g.translate(8, 8);
    g.rotate(0.5);
    g.fillRect(-5, -3, 10, 6);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.mat = new THREE.PointsMaterial({ map: tex, size: 0.6, transparent: true, depthWrite: false, opacity: 0.85, sizeAttenuation: true });
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    const rnd = mulberry32(77);
    for (let i = 0; i < max; i++) {
      this.pos.set([(rnd() - 0.5) * 70, rnd() * 28, (rnd() - 0.5) * 70], i * 3);
      this.vel.set([rnd() - 0.5, 0.5 + rnd(), rnd() - 0.5], i * 3);
    }
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    this.setKind("needles");
  }
  setKind(k: WeatherKind) {
    this.kind = k;
    const w = WEATHER[k];
    this.mat.color.set(w.color);
    this.mat.size = w.size;
  }
  setCount(n: number) {
    this.points.geometry.setDrawRange(0, Math.min(this.max, Math.max(0, n)));
  }
  update(dt: number, focus: THREE.Vector3, t: number) {
    const w = WEATHER[this.kind];
    for (let i = 0; i < this.max; i++) {
      const j = i * 3;
      const sway = Math.sin(t * 0.8 + i) * w.sway;
      this.pos[j] = this.pos[j]! + (this.vel[j]! * w.sway * 0.4 + w.drift + sway * 0.3) * dt;
      this.pos[j + 1] = this.pos[j + 1]! - (w.fall * (0.6 + this.vel[j + 1]! * 0.5) - (w.fall < 0 ? 0 : 0)) * dt;
      this.pos[j + 2] = this.pos[j + 2]! + (this.vel[j + 2]! * w.sway * 0.4 + Math.cos(t * 0.7 + i) * w.sway * 0.3) * dt;
      // wrap inside a box that follows the focus
      for (const [a, half] of [[0, 36], [2, 36]] as const) {
        const rel = this.pos[j + a]! - focus.getComponent(a);
        if (rel > half) this.pos[j + a] = this.pos[j + a]! - half * 2;
        else if (rel < -half) this.pos[j + a] = this.pos[j + a]! + half * 2;
      }
      if (this.pos[j + 1]! < focus.y - 2) this.pos[j + 1] = focus.y + 24;
      else if (this.pos[j + 1]! > focus.y + 26) this.pos[j + 1] = focus.y - 1;
    }
    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}

/* ---------- warning curtain + hazards for collapsing wedges ---------- */
function curtainTexture() {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 64, 0, 0);
  grad.addColorStop(0, "rgba(255,255,255,0.95)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.35)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const HAZARD_COLOR = ["#7aa65a", "#555049", "#4e4c47", "#c8d65a", "#cfe8f5", "#c77ab5"];
const HAZARD_KIND = ["flood", "fire", "fire", "fog", "fog", "fog"] as const;

export class Hazards {
  readonly group = new THREE.Group();
  private warn: THREE.Mesh[] = [];
  private warnMats: THREE.MeshBasicMaterial[] = [];
  private fire: { mesh: THREE.InstancedMesh; pos: THREE.Vector3[]; seed: number[]; wedge: number }[] = [];
  private fogs: { sheets: FogSheets; wedge: number }[] = [];
  readonly intensity = [0, 0, 0, 0, 0, 0];
  private dummy = new THREE.Object3D();

  constructor(private kit: PaperKit, tex: THREE.Texture) {
    const curtain = curtainTexture();
    for (let w = 0; w < 6; w++) {
      const [o, a, b] = wedgeCorners(w);
      const pts = [[o!, a!], [a!, b!], [b!, o!]];
      const verts: number[] = [], uv: number[] = [], idx: number[] = [];
      const H = 26;
      pts.forEach(([p, q], i) => {
        verts.push(p!.x, 0, p!.y, q!.x, 0, q!.y, q!.x, H, q!.y, p!.x, H, p!.y);
        uv.push(0, 0, 1, 0, 1, 1, 0, 1);
        idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      const mat = new THREE.MeshBasicMaterial({ map: curtain, color: "#ff3b2a", transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.warn.push(mesh);
      this.warnMats.push(mat);
      this.group.add(mesh);

      const kind = HAZARD_KIND[w]!;
      const rnd = mulberry32(900 + w);
      const area = (r: () => number): [number, number] => {
        for (;;) {
          let u = r(), v = r();
          if (u + v > 1) [u, v] = [1 - u, 1 - v];
          const x = a!.x * u + b!.x * v, z = a!.y * u + b!.y * v;
          if (Math.hypot(x, z) > 15) return [x, z];
        }
      };
      if (kind === "fire") {
        const mat = new THREE.MeshStandardMaterial({ color: "#ff7a1c", emissive: "#ff4a0a", emissiveIntensity: 1.4, flatShading: true });
        const mesh = new THREE.InstancedMesh(new THREE.ConeGeometry(0.9, 3.4, 5), mat, 150);
        mesh.frustumCulled = false;
        mesh.visible = false;
        const pos: THREE.Vector3[] = [], seed: number[] = [];
        for (let i = 0; i < 150; i++) {
          const [x, z] = area(rnd);
          pos.push(new THREE.Vector3(x, terrainY(x, z), z));
          seed.push(rnd() * 20);
        }
        this.fire.push({ mesh, pos, seed, wedge: w });
        this.group.add(mesh);
      }
      if (kind !== "flood") {
        const s = new FogSheets(tex, kind === "fire" ? 18 : 36, HAZARD_COLOR[w]!, area, kind === "fire" ? 7 : 3, kind === "fire" ? 12 : 9, kind === "fire" ? 26 : 22, 40 + w);
        s.mesh.visible = false;
        this.fogs.push({ sheets: s, wedge: w });
        this.group.add(s.mesh);
      }
    }
  }

  /** zone: warningZone (or null), collapsed indices. Returns marsh flood level 0..1. */
  update(dt: number, t: number, warning: number | null, collapsed: number[], quality: number) {
    for (let w = 0; w < 6; w++) {
      const target = collapsed.includes(w) ? 1 : 0;
      this.intensity[w] = damp(this.intensity[w]!, target, 0.6, dt);
      const isWarn = warning === w;
      const m = this.warn[w]!;
      m.visible = isWarn || collapsed.includes(w);
      this.warnMats[w]!.opacity = isWarn ? 0.42 + Math.sin(t * 6) * 0.22 : collapsed.includes(w) ? 0.18 : 0;
      this.warnMats[w]!.color.set(isWarn ? "#ff3b2a" : HAZARD_COLOR[w]!);
    }
    for (const f of this.fire) {
      const k = this.intensity[f.wedge]!;
      f.mesh.visible = k > 0.02;
      if (!f.mesh.visible) continue;
      f.pos.forEach((p, i) => {
        const flick = 0.7 + Math.sin(t * 8 + f.seed[i]!) * 0.25 + Math.sin(t * 13 + f.seed[i]! * 2) * 0.12;
        this.dummy.position.set(p.x, p.y + 1.4 * k * flick, p.z);
        this.dummy.scale.set(k * (1.2 + Math.sin(t * 5 + i) * 0.2), k * flick * 2.1, k * 1.2);
        this.dummy.rotation.y = f.seed[i]! + t * 0.4;
        this.dummy.updateMatrix();
        f.mesh.setMatrixAt(i, this.dummy.matrix);
      });
      f.mesh.count = Math.max(8, Math.floor(150 * (quality >= 3 ? 0.35 : 1)));
      f.mesh.instanceMatrix.needsUpdate = true;
    }
    for (const f of this.fogs) {
      const k = this.intensity[f.wedge]!;
      f.sheets.mesh.visible = k > 0.02;
      if (!f.sheets.mesh.visible) continue;
      f.sheets.setStyle(HAZARD_COLOR[f.wedge]!, 0.8 * k);
      f.sheets.setVisible(quality >= 3 ? 10 : 30);
      f.sheets.update(t);
    }
    return this.intensity[0]!;
  }
  isHazardous(w: number) {
    return this.intensity[w]! > 0.3;
  }
}

/* ---------- helicopter and flare ---------- */
export class Helicopter {
  readonly group = new THREE.Group();
  private rotor = new THREE.Group();
  private tailRotor = new THREE.Group();
  constructor(kit: PaperKit) {
    const mat = (c: string, o = {}) => kit.mat(c, { repeat: 0.5, ...o });
    const body = new THREE.Mesh(new THREE.SphereGeometry(2.4, 10, 8), mat("#b9473a", { flat: true }));
    body.scale.set(1.35, 1, 1);
    const glass = new THREE.Mesh(new THREE.SphereGeometry(1.6, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat("#9fd0e0", { transparent: true, opacity: 0.7, roughness: 0.3 }));
    glass.position.set(1.8, 0.4, 0);
    glass.rotation.z = -0.9;
    const tail = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.55, 0.45), mat("#a33c31"));
    tail.position.set(-4.6, 0.6, 0);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.7, 0.3), mat("#e8dcc4"));
    fin.position.set(-7, 1.3, 0);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 1.0, 6), mat("#403a34"));
    mast.position.y = 2.7;
    this.rotor.position.y = 3.25;
    for (let i = 0; i < 2; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(11.5, 0.07, 0.65), mat("#e8dcc4"));
      b.rotation.y = i * Math.PI / 2;
      this.rotor.add(b);
    }
    this.tailRotor.position.set(-7.2, 1.4, 0.35);
    const tb = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.2, 0.06), mat("#e8dcc4"));
    this.tailRotor.add(tb);
    const skid = (z: number) => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.BoxGeometry(5, 0.14, 0.14), mat("#403a34")));
      for (const x of [-1.4, 1.4]) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.5, 0.12), mat("#403a34")); s.position.set(x, 0.75, 0); g.add(s); }
      g.position.set(0.2, -2.4, z);
      return g;
    };
    this.group.add(body, glass, tail, fin, mast, this.rotor, this.tailRotor, skid(1.5), skid(-1.5));
    this.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
    this.group.visible = false;
  }
  update(t: number, spin = 1) {
    this.rotor.rotation.y = t * 30 * spin;
    this.tailRotor.rotation.x = t * 40 * spin;
  }
}

export class FlareFx {
  readonly group = new THREE.Group();
  readonly light = new THREE.PointLight("#ff3b2a", 0, 80, 1.6);
  private beam: THREE.Mesh;
  private smoke: THREE.Mesh;
  constructor() {
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 1.4, 90, 8, 1, true), new THREE.MeshBasicMaterial({ color: "#ff4a36", transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.beam.position.y = 45;
    this.smoke = new THREE.Mesh(new THREE.SphereGeometry(1.2, 8, 6), new THREE.MeshBasicMaterial({ color: "#ff6a50" }));
    this.smoke.position.y = 6;
    this.light.position.y = 7;
    this.group.add(this.beam, this.smoke, this.light);
    this.group.visible = false;
  }
  update(t: number, on: boolean) {
    this.group.visible = on;
    if (!on) return;
    this.light.intensity = 900 + Math.sin(t * 20) * 250;
    this.smoke.scale.setScalar(1 + Math.sin(t * 15) * 0.2);
    (this.beam.material as THREE.MeshBasicMaterial).opacity = 0.28 + Math.sin(t * 9) * 0.08;
  }
}

export { cloudTexture, ARENA_APOTHEM, ARENA_R, clamp, wedgeCentre, wedgeDistance };
