import * as THREE from "three";
import type { FigureLook } from "@ashen-crown/shared";
import { buildItem, card, type Weapon } from "./items";
import type { PaperKit } from "./paper";
import { clamp, damp, lerp, mix } from "./util";
import type { Crest } from "../content";

type Pt = [number, number];

export function crestPoints(c: Crest): Pt[] {
  switch (c) {
    case "flame": return [[0, 0.5], [0.22, 0.15], [0.18, -0.1], [0.3, -0.2], [0.15, -0.5], [-0.15, -0.5], [-0.3, -0.2], [-0.12, 0.1], [-0.05, 0.22]];
    case "reed": return [[-0.45, -0.5], [-0.35, 0.35], [-0.25, -0.5], [-0.1, -0.5], [0, 0.5], [0.1, -0.5], [0.25, -0.5], [0.35, 0.2], [0.45, -0.5]];
    case "pine": return [[0, 0.5], [0.3, 0.1], [0.15, 0.1], [0.38, -0.25], [0.08, -0.25], [0.08, -0.5], [-0.08, -0.5], [-0.08, -0.25], [-0.38, -0.25], [-0.15, 0.1], [-0.3, 0.1]];
    case "sun": return Array.from({ length: 24 }, (_, i) => { const r = i % 2 ? 0.34 : 0.5, a = (i / 24) * Math.PI * 2; return [Math.cos(a) * r, Math.sin(a) * r] as Pt; });
    case "shard": return [[0, 0.55], [0.24, 0.1], [0.12, -0.5], [-0.12, -0.5], [-0.24, 0.1]];
    default: return Array.from({ length: 32 }, (_, i) => { const a = (i / 32) * Math.PI * 2; const dent = 0.1 * Math.exp(-((a - Math.PI / 2) ** 2) / 0.06); return [Math.cos(a) * (0.4 - dent), Math.sin(a) * (0.4 - dent) - 0.04] as Pt; });
  }
}

export interface FigureOpts {
  hearthColor: string;
  accent: string;
  crest: Crest;
  look: FigureLook;
  skin: string;
}
export interface Pose {
  speed: number;
  sprint?: boolean;
  block?: boolean;
  dead?: boolean;
  /** Unused now that figures are fully 3D; kept so callers needn't change. */
  facing?: number;
  speaking?: boolean;
}

/** A faceted folded-paper figure: solid low-poly volumes, brass-brad joints, procedural walk, strike, block and fold-flat death. */
export class PaperFigure {
  readonly object = new THREE.Group();
  /** Turn group: rotate its y to face a direction (forward is +z). */
  readonly billboard = new THREE.Group();
  readonly height = 3.05;
  private body = new THREE.Group();
  private hip = new THREE.Group();
  private head = new THREE.Group();
  private sL = new THREE.Group(); private sR = new THREE.Group();
  private eL = new THREE.Group(); private eR = new THREE.Group();
  private hL = new THREE.Group(); private hR = new THREE.Group();
  private kL = new THREE.Group(); private kR = new THREE.Group();
  private handR = new THREE.Group();
  private handL = new THREE.Group();
  private torso!: THREE.Mesh;
  private held: THREE.Group | null = null;
  private heldKey = "";
  private ring: THREE.Mesh;
  private ringMat: THREE.MeshBasicMaterial;
  private phase = Math.random() * 6;
  private attackT = 0;
  private fold = 0;
  private lean = 0;
  private geos: THREE.BufferGeometry[] = [];

  constructor(private kit: PaperKit, private o: FigureOpts) {
    const col = o.hearthColor;
    const dark = mix(col, "#1d1a18", 0.5).getStyle();
    const light = mix(col, "#ffffff", 0.2).getStyle();
    const trouser = mix(col, "#2c2a33", 0.62).getStyle();
    const m = (c: string, extra = {}) => kit.mat(c, { flat: true, repeat: 0.9, normalScale: 0.55, ...extra });
    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, color: string, x = 0, y = 0, z = 0, extra = {}) => {
      const mesh = new THREE.Mesh(geo, m(color, extra));
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      this.geos.push(geo);
      parent.add(mesh);
      return mesh;
    };
    const cyl = (rt: number, rb: number, h: number, seg = 6) => new THREE.CylinderGeometry(rt, rb, h, seg);
    const ball = (r: number, detail = 0) => new THREE.IcosahedronGeometry(r, detail);
    const brad = (parent: THREE.Object3D, x = 0, y = 0, z = 0) => {
      const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.075, 0), kit.brass());
      b.position.set(x, y, z);
      this.geos.push(b.geometry);
      parent.add(b);
    };

    this.object.add(this.billboard);
    this.billboard.add(this.body);
    this.body.add(this.hip);
    this.hip.position.y = 1.26;

    // legs
    for (const [side, hp, kn] of [[-1, this.hL, this.kL], [1, this.hR, this.kR]] as const) {
      hp.position.set(side * 0.2, 0, 0);
      this.hip.add(hp);
      add(hp, cyl(0.17, 0.14, 0.6), trouser, 0, -0.3, 0);
      kn.position.set(0, -0.6, 0);
      hp.add(kn);
      add(kn, cyl(0.14, 0.11, 0.56), trouser, 0, -0.28, 0);
      add(kn, new THREE.BoxGeometry(0.3, 0.2, 0.46), "#4a3a2c", 0, -0.58, 0.07);
      brad(kn, 0, 0, 0);
    }
    // pelvis, torso, belt
    add(this.hip, new THREE.BoxGeometry(0.72, 0.3, 0.44), trouser, 0, 0.05, 0);
    this.torso = add(this.hip, cyl(0.42, 0.34, 0.96, 6), col, 0, 0.62, 0);
    this.torso.scale.z = 0.62;
    add(this.hip, new THREE.BoxGeometry(0.76, 0.09, 0.5), "#5a432f", 0, 0.2, 0);
    add(this.hip, new THREE.BoxGeometry(0.12, 0.12, 0.05), "#c9a24a", 0, 0.2, 0.26, { metalness: 0.7 });
    // chest crest: flat cut-paper badge stuck on the front
    const crest = card(kit, crestPoints(o.crest).map(([x, y]) => [x * 0.34, y * 0.34] as Pt), "#f3ead4", 0.04);
    crest.position.set(0, 0.7, 0.265);
    this.geos.push(crest.geometry);
    this.hip.add(crest);
    // neck, head
    add(this.hip, cyl(0.1, 0.12, 0.2), o.skin, 0, 1.15, 0);
    this.head.position.set(0, 1.25, 0);
    this.hip.add(this.head);
    add(this.head, ball(0.37, 1), o.skin, 0, 0.36, 0);
    for (const x of [-0.13, 0.13]) add(this.head, new THREE.BoxGeometry(0.07, 0.1, 0.05), "#2a2420", x, 0.4, 0.34);
    add(this.head, new THREE.BoxGeometry(0.1, 0.06, 0.06), mix(o.skin, "#b5604a", 0.5).getStyle(), 0, 0.2, 0.34);
    brad(this.hip, 0, 1.05, 0.0);
    // arms
    for (const [side, sh, el, hand] of [[-1, this.sL, this.eL, this.handL], [1, this.sR, this.eR, this.handR]] as const) {
      sh.position.set(side * 0.55, 0.98, 0);
      this.hip.add(sh);
      add(sh, ball(0.19, 0), light, 0, 0, 0);
      add(sh, cyl(0.12, 0.1, 0.5), light, 0, -0.26, 0);
      el.position.set(0, -0.52, 0);
      sh.add(el);
      add(el, cyl(0.1, 0.085, 0.48), col, 0, -0.25, 0);
      brad(el, 0, 0, 0);
      hand.position.set(0, -0.52, 0);
      el.add(hand);
      add(hand, ball(0.11, 0), o.skin, 0, 0, 0);
    }
    this.buildLook(add, cyl, ball, dark);

    this.ringMat = new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0, depthWrite: false });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.5, 28), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.08;
    this.object.add(this.ring);
    this.pose({ speed: 0 }, 0);
  }

  private buildLook(add: (p: THREE.Object3D, g: THREE.BufferGeometry, c: string, x?: number, y?: number, z?: number, e?: object) => THREE.Mesh, cyl: (a: number, b: number, h: number, s?: number) => THREE.BufferGeometry, ball: (r: number, d?: number) => THREE.BufferGeometry, dark: string) {
    const { o } = this;
    const acc = o.accent, col = o.hearthColor;
    const cap = (r: number, frac: number) => new THREE.SphereGeometry(r, 8, 6, 0, Math.PI * 2, 0, Math.PI * frac);
    switch (o.look) {
      case "scout": {
        add(this.head, cap(0.4, 0.56), "#4a3426", 0, 0.38, -0.02);
        const scarf = add(this.hip, new THREE.TorusGeometry(0.2, 0.075, 5, 8), acc, 0, 1.06, 0);
        scarf.rotation.x = Math.PI / 2;
        add(this.hip, new THREE.BoxGeometry(0.12, 0.45, 0.06), acc, 0.06, 0.78, 0.2);
        add(this.hip, new THREE.BoxGeometry(0.34, 0.3, 0.14), "#6b4f33", -0.5, 0.1, 0);
        const strap = add(this.hip, new THREE.BoxGeometry(0.06, 1.0, 0.04), "#6b4f33", 0, 0.65, 0.2);
        strap.rotation.z = -0.55;
        break;
      }
      case "warden": {
        add(this.head, new THREE.SphereGeometry(0.46, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.64), dark, 0, 0.34, -0.03);
        add(this.hip, new THREE.BoxGeometry(0.95, 1.5, 0.07), dark, 0, 0.35, -0.3);
        for (const x of [-0.58, 0.58]) add(this.hip, ball(0.26, 0), "#b9c0c5", x, 1.05, 0, { metalness: 0.4 });
        add(this.hip, new THREE.BoxGeometry(0.52, 0.5, 0.09), mix(col, "#ffffff", 0.25).getStyle(), 0, 0.5, 0.25);
        break;
      }
      case "ranger": {
        add(this.head, new THREE.SphereGeometry(0.44, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.6), "#4f6b45", 0, 0.36, -0.03);
        const quiver = add(this.hip, cyl(0.11, 0.11, 0.85), "#7b5b3c", 0.2, 0.62, -0.3);
        quiver.rotation.z = -0.25;
        for (let i = 0; i < 3; i++) { const c = add(this.hip, new THREE.ConeGeometry(0.05, 0.16, 4), acc, 0.32 + i * 0.04, 1.12 - i * 0.02, -0.3); c.rotation.z = -0.25; }
        add(this.hip, new THREE.BoxGeometry(0.76, 0.12, 0.5), "#5e4329", 0, 0.32, 0);
        break;
      }
      default: { // duelist
        add(this.head, cap(0.4, 0.5), "#2a2420", 0, 0.4, -0.02);
        const plume = add(this.head, new THREE.ConeGeometry(0.09, 0.7, 4), acc, 0.3, 0.8, -0.05);
        plume.rotation.z = -0.7;
        const sash = add(this.hip, new THREE.BoxGeometry(0.13, 1.15, 0.06), acc, 0, 0.62, 0.27);
        sash.rotation.z = 0.6;
        add(this.hip, new THREE.BoxGeometry(0.78, 0.1, 0.5), "#2a2420", 0, 0.2, 0);
      }
    }
  }

  /** Switch the held item. Weapons sit in the right hand, bows in the left, torches in the right. */
  setHeld(w: Weapon | "torch" | "none") {
    if (w === this.heldKey) return;
    this.heldKey = w;
    if (this.held) { this.held.parent?.remove(this.held); this.held = null; }
    if (w === "none") return;
    const g = buildItem(this.kit, w);
    // item models are built blade-up; tip them forward so they read from every angle
    const tilt: Record<string, [number, number]> = { dagger: [-1.15, 0], spear: [-0.25, 0], axe: [-0.9, 0], bow: [0, Math.PI / 2], crossbow: [-1.5, 0], torch: [-0.35, 0] };
    const [rx, ry] = tilt[w] ?? [0, 0];
    g.rotation.set(rx, ry, 0);
    g.scale.setScalar(w === "dagger" ? 1.25 : 1.1);
    (w === "bow" ? this.handL : this.handR).add(g);
    this.held = g;
  }

  /** Ground ring: self, ally or target highlight. */
  setMarker(color: string | null, opacity = 0.9) {
    this.ringMat.opacity = color ? opacity : 0;
    if (color) this.ringMat.color.set(color);
  }
  setPulse(t: number) {
    if (this.ringMat.opacity > 0) this.ring.scale.setScalar(1 + Math.sin(t * 5) * 0.06);
  }

  strike() { this.attackT = 0.36; }

  pose(p: Pose, dt: number) {
    const k = dt || 1;
    const amp = clamp(p.speed / 6, 0, 1);
    this.phase += dt * (3 + p.speed * 1.25);
    const s = Math.sin(this.phase);
    const idle = Math.sin(performance.now() * 0.002 + this.phase * 0.1);

    this.fold = damp(this.fold, p.dead ? 1 : 0, 7, k);
    this.lean = damp(this.lean, p.sprint ? 0.2 : 0, 8, k);
    this.body.rotation.x = -this.fold * (Math.PI / 2 - 0.02) + this.lean;
    this.body.position.y = this.fold * 0.36;

    this.hL.rotation.x = -s * 0.8 * amp;
    this.hR.rotation.x = s * 0.8 * amp;
    this.kL.rotation.x = Math.max(0, s) * 0.95 * amp;
    this.kR.rotation.x = Math.max(0, -s) * 0.95 * amp;
    this.hip.position.y = 1.26 + Math.abs(s) * 0.08 * amp + idle * 0.012;
    this.torso.scale.y = 1 + idle * 0.012;

    let rS = -s * 0.65 * amp, lS = s * 0.65 * amp, rE = -0.3 - amp * 0.25, lE = -0.3 - amp * 0.25, twist = 0;
    if (this.heldKey === "spear") rS = -0.35 - s * 0.15 * amp;
    if (p.block) { rS = -1.35; lS = -1.35; rE = -1.55; lE = -1.55; }
    if (this.attackT > 0) {
      this.attackT = Math.max(0, this.attackT - dt);
      const t = 1 - this.attackT / 0.36;
      rS = t < 0.4 ? lerp(-0.3, -2.6, t / 0.4) : lerp(-2.6, -0.2, (t - 0.4) / 0.6);
      rE = t < 0.4 ? -0.4 : -0.1;
      twist = t < 0.4 ? lerp(0, 0.35, t / 0.4) : lerp(0.35, -0.25, (t - 0.4) / 0.6);
    }
    this.sR.rotation.x = damp(this.sR.rotation.x, rS, 28, k);
    this.sL.rotation.x = damp(this.sL.rotation.x, lS, 28, k);
    this.eR.rotation.x = damp(this.eR.rotation.x, rE, 24, k);
    this.eL.rotation.x = damp(this.eL.rotation.x, lE, 24, k);
    this.sR.rotation.z = damp(this.sR.rotation.z, p.block ? -0.25 : -0.08, 12, k);
    this.sL.rotation.z = damp(this.sL.rotation.z, p.block ? 0.25 : 0.08, 12, k);
    this.hip.rotation.y = damp(this.hip.rotation.y, twist + s * 0.12 * amp, 20, k);
    this.head.rotation.y = Math.sin(this.phase * 0.5) * 0.05 * amp + idle * 0.05;
    this.head.rotation.x = idle * 0.02;
    const flame = this.held?.getObjectByName("flame");
    if (flame) flame.scale.set(1 + Math.sin(this.phase * 9) * 0.1, 1 + Math.sin(this.phase * 13) * 0.18, 1);
  }

  dispose() {
    this.geos.forEach((g) => g.dispose());
    this.ring.geometry.dispose();
    this.ringMat.dispose();
  }
}
