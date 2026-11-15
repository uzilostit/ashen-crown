import * as THREE from "three";
import type { FigureLook } from "@ashen-crown/shared";
import { card, buildItem, type Weapon } from "./items";
import type { PaperKit } from "./paper";
import { clamp, damp, lerp, mix } from "./util";
import type { Crest } from "../content";

type Pt = [number, number];
const limb = (len: number, w0: number, w1: number): Pt[] => [[-w0 / 2, 0], [w0 / 2, 0], [w1 / 2, -len], [-w1 / 2, -len]];
const disc = (r: number, n = 14): Pt[] => Array.from({ length: n }, (_, i) => [Math.cos((i / n) * Math.PI * 2) * r, Math.sin((i / n) * Math.PI * 2) * r]);

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
  facing?: number;
  speaking?: boolean;
}

/** An articulated cut-paper standee: flat parts, brass brad joints, procedural animation. */
export class PaperFigure {
  readonly object = new THREE.Group();
  readonly billboard = new THREE.Group();
  readonly height = 3;
  private flip = new THREE.Group();
  private body = new THREE.Group();
  private hip = new THREE.Group();
  private head = new THREE.Group();
  private sL = new THREE.Group(); private sR = new THREE.Group();
  private eL = new THREE.Group(); private eR = new THREE.Group();
  private hL = new THREE.Group(); private hR = new THREE.Group();
  private kL = new THREE.Group(); private kR = new THREE.Group();
  private handR = new THREE.Group();
  private handL = new THREE.Group();
  private held: THREE.Group | null = null;
  private heldKey = "";
  private ring: THREE.Mesh;
  private ringMat: THREE.MeshBasicMaterial;
  private phase = Math.random() * 6;
  private attackT = 0;
  private fold = 0;
  private facing = 1;
  private geos: THREE.BufferGeometry[] = [];

  constructor(private kit: PaperKit, private o: FigureOpts) {
    const { hearthColor: col } = o;
    const dark = mix(col, "#1d1a18", 0.5).getStyle();
    const light = mix(col, "#ffffff", 0.22).getStyle();
    const trouser = mix(col, "#2c2a33", 0.62).getStyle();
    const boots = "#4a3a2c";
    const add = (parent: THREE.Object3D, pts: Pt[], color: string, x = 0, y = 0, z = 0, depth = 0.1) => {
      const m = card(kit, pts, color, depth);
      m.position.set(x, y, z);
      this.geos.push(m.geometry);
      parent.add(m);
      return m;
    };
    const brad = (parent: THREE.Object3D, x: number, y: number, z: number) => {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.1, 8), kit.brass());
      b.rotation.x = Math.PI / 2;
      b.position.set(x, y, z);
      this.geos.push(b.geometry);
      parent.add(b);
    };

    this.object.add(this.billboard);
    this.billboard.add(this.flip);
    this.flip.add(this.body);
    this.body.add(this.hip);
    this.hip.position.y = 1.2;

    // legs sit just behind the torso
    for (const [side, hp, kn] of [[-1, this.hL, this.kL], [1, this.hR, this.kR]] as const) {
      hp.position.set(side * 0.17, 0, -0.06);
      this.hip.add(hp);
      add(hp, limb(0.6, 0.26, 0.2), trouser, 0, 0, 0, 0.09);
      kn.position.set(0, -0.6, 0);
      hp.add(kn);
      add(kn, limb(0.56, 0.2, 0.17), trouser, 0, 0, 0.01, 0.09);
      add(kn, [[-0.1, -0.56], [0.12, -0.56], [0.3, -0.7], [0.3, -0.76], [-0.1, -0.76]], boots, 0, 0, 0.02, 0.1);
      brad(hp, 0, 0, 0.07);
      brad(kn, 0, 0, 0.07);
    }
    // torso
    add(this.hip, [[-0.3, 0], [0.3, 0], [0.43, 0.9], [-0.43, 0.9]], col, 0, 0, 0, 0.12);
    add(this.hip, [[-0.3, 0], [0.3, 0], [0.32, 0.12], [-0.32, 0.12]], dark, 0, 0, 0.07, 0.04);
    const crest = add(this.hip, crestPoints(o.crest).map(([x, y]) => [x * 0.36, y * 0.36] as Pt), "#f3ead4", 0, 0.5, 0.08, 0.03);
    crest.scale.setScalar(1);
    // head
    this.head.position.set(0, 0.97, 0.03);
    this.hip.add(this.head);
    add(this.head, [[-0.07, -0.05], [0.07, -0.05], [0.07, 0.16], [-0.07, 0.16]], o.skin, 0, 0, -0.02, 0.06);
    add(this.head, disc(0.34, 18), o.skin, 0, 0.44, 0.02, 0.1);
    for (const x of [-0.12, 0.12]) {
      const e = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 8), new THREE.MeshStandardMaterial({ color: "#2a2420", roughness: 0.6 }));
      e.rotation.x = Math.PI / 2;
      e.position.set(x, 0.46, 0.072);
      this.geos.push(e.geometry);
      this.head.add(e);
    }
    add(this.head, [[-0.07, 0.34], [0.07, 0.34], [0.0, 0.3]], mix(o.skin, "#c0705a", 0.45).getStyle(), 0, 0, 0.065, 0.01);
    brad(this.hip, 0, 0.98, 0.09);
    // arms
    for (const [side, sh, el, hand] of [[-1, this.sL, this.eL, this.handL], [1, this.sR, this.eR, this.handR]] as const) {
      sh.position.set(side * 0.46, 0.8, 0.1);
      this.hip.add(sh);
      add(sh, limb(0.5, 0.2, 0.17), light, 0, 0, 0, 0.09);
      el.position.set(0, -0.5, 0.01);
      sh.add(el);
      add(el, limb(0.5, 0.16, 0.13), col, 0, 0, 0, 0.09);
      hand.position.set(0, -0.54, 0.01);
      el.add(hand);
      add(hand, disc(0.1, 10), o.skin, 0, 0, 0, 0.09);
      brad(sh, 0, 0, 0.065);
      brad(el, 0, 0, 0.065);
    }
    this.buildLook();

    const ringMat = (this.ringMat = new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.0, depthWrite: false }));
    this.ring = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.45, 28), ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.08;
    this.object.add(this.ring);
    this.pose({ speed: 0 }, 0);
    this.object.traverse((n) => { if ((n as THREE.Mesh).isMesh) (n as THREE.Mesh).castShadow = true; });
    this.ring.castShadow = false;
  }

  private buildLook() {
    const { kit, o } = this;
    const col = o.hearthColor, acc = o.accent;
    const add = (parent: THREE.Object3D, pts: Pt[], color: string, x: number, y: number, z: number, depth = 0.08) => {
      const m = card(kit, pts, color, depth);
      m.position.set(x, y, z);
      this.geos.push(m.geometry);
      parent.add(m);
      return m;
    };
    const hair = (c: string) => add(this.head, [[-0.35, 0.42], [-0.3, 0.64], [-0.1, 0.77], [0.15, 0.76], [0.33, 0.62], [0.35, 0.42], [0.25, 0.54], [0, 0.6], [-0.22, 0.54]], c, 0, 0, 0.04, 0.12);
    switch (o.look) {
      case "scout":
        hair("#4a3426");
        add(this.hip, [[-0.26, 0.9], [0.26, 0.9], [0.22, 0.74], [-0.22, 0.74]], acc, 0, 0, 0.1, 0.06);
        add(this.hip, [[0.05, 0.78], [0.2, 0.78], [0.18, 0.3], [0.06, 0.3]], acc, 0.02, 0, 0.1, 0.05);
        add(this.hip, [[0, 0], [0.3, 0], [0.3, -0.3], [0, -0.3]], "#6b4f33", -0.46, 0.35, -0.12, 0.1);
        break;
      case "warden":
        add(this.hip, [[-0.34, 0.9], [0.34, 0.9], [0.5, -0.5], [-0.5, -0.5]], mix(col, "#14110f", 0.55).getStyle(), 0, 0, -0.2, 0.06);
        for (const x of [-0.46, 0.46]) add(this.hip, disc(0.23, 8), "#b9c0c5", x, 0.88, 0.2, 0.07);
        add(this.hip, [[-0.2, 0.15], [0.2, 0.15], [0.26, 0.82], [-0.26, 0.82]], mix(col, "#ffffff", 0.18).getStyle(), 0, 0, 0.13, 0.05);
        add(this.head, [[-0.4, 0.2], [-0.42, 0.62], [-0.2, 0.84], [0.2, 0.84], [0.42, 0.62], [0.4, 0.2], [0.3, 0.45], [0, 0.55], [-0.3, 0.45]], mix(col, "#14110f", 0.45).getStyle(), 0, 0, 0.05, 0.14);
        break;
      case "ranger":
        add(this.head, [[-0.42, 0.28], [-0.42, 0.62], [-0.2, 0.84], [0.2, 0.84], [0.42, 0.62], [0.42, 0.28], [0.3, 0.46], [0, 0.56], [-0.3, 0.46]], "#4f6b45", 0, 0, 0.05, 0.13);
        add(this.hip, [[-0.07, 0], [0.07, 0], [0.07, 0.9], [-0.07, 0.9]], "#7b5b3c", 0.18, 0.2, -0.17, 0.12).rotation.z = -0.22;
        for (let i = 0; i < 3; i++) add(this.hip, [[0, 0], [0.06, 0.14], [-0.06, 0.14]], acc, 0.22 + i * 0.04, 1.2 - i * 0.02, -0.2, 0.02).rotation.z = -0.22;
        add(this.hip, [[-0.3, 0], [0.3, 0], [0.3, 0.1], [-0.3, 0.1]], "#5e4329", 0, 0.2, 0.09, 0.05);
        break;
      default: // duelist
        hair("#2a2420");
        add(this.head, [[0, 0], [0.12, 0.3], [0.04, 0.62], [-0.05, 0.3]], acc, 0.22, 0.6, 0.05, 0.05).rotation.z = -0.5;
        add(this.hip, [[-0.4, 0.88], [-0.22, 0.88], [0.42, 0.06], [0.24, 0.06]], acc, 0, 0, 0.1, 0.05);
        add(this.hip, [[-0.3, 0.04], [0.3, 0.04], [0.3, 0.14], [-0.3, 0.14]], "#2a2420", 0, 0, 0.1, 0.05);
    }
  }

  /** Switch the held item. Weapons sit in the right hand, bows in the left, torches in the right. */
  setHeld(w: Weapon | "torch" | "none") {
    if (w === this.heldKey) return;
    this.heldKey = w;
    if (this.held) { this.held.parent?.remove(this.held); this.held = null; }
    if (w === "none") return;
    const g = buildItem(this.kit, w);
    const rot: Record<string, number> = { dagger: -0.85, spear: -0.08, axe: -0.7, bow: 0, crossbow: -1.2, torch: -0.35 };
    const left = w === "bow";
    g.rotation.z = rot[w] ?? 0;
    g.position.z = 0.09;
    g.scale.setScalar(w === "dagger" ? 1.15 : 1);
    (left ? this.handL : this.handR).add(g);
    this.held = g;
  }

  /** Brief ground ring: self, ally or target highlight. */
  setMarker(color: string | null, opacity = 0.9) {
    this.ringMat.opacity = color ? opacity : 0;
    if (color) this.ringMat.color.set(color);
  }
  setPulse(t: number) {
    if (this.ringMat.opacity > 0) this.ring.scale.setScalar(1 + Math.sin(t * 5) * 0.06);
  }

  strike() { this.attackT = 0.34; }

  pose(p: Pose, dt: number) {
    const amp = clamp(p.speed / 6, 0, 1);
    this.phase += dt * (3 + p.speed * 1.25);
    const s = Math.sin(this.phase);
    const idle = Math.sin(performance.now() * 0.002 + this.phase * 0.1);
    if (p.facing) this.facing = damp(this.facing, p.facing, 18, dt || 1);
    this.flip.scale.x = Math.abs(this.facing) < 0.2 ? Math.sign(p.facing ?? 1) * 0.2 : this.facing;

    this.fold = damp(this.fold, p.dead ? 1 : 0, 7, dt || 1);
    this.body.rotation.x = -this.fold * (Math.PI / 2 - 0.02);
    this.body.position.y = this.fold * 0.1;
    this.body.position.z = this.fold * -0.2;

    this.hL.rotation.z = s * 0.65 * amp;
    this.hR.rotation.z = -s * 0.65 * amp;
    this.kL.rotation.z = Math.max(0, -s) * 0.9 * amp;
    this.kR.rotation.z = Math.max(0, s) * 0.9 * amp;
    this.hip.position.y = 1.2 + Math.abs(s) * 0.08 * amp + idle * 0.012;
    this.body.rotation.z = p.sprint ? -0.14 : 0;

    let rShoulder = -0.12 - s * 0.55 * amp, lShoulder = 0.12 + s * 0.55 * amp, rElbow = -0.15, lElbow = 0.15;
    if (this.heldKey === "spear") rShoulder = -0.1 - s * 0.15 * amp;
    if (p.block) { rShoulder = -2.0; lShoulder = 2.0; rElbow = 1.7; lElbow = -1.7; }
    if (this.attackT > 0) {
      this.attackT = Math.max(0, this.attackT - dt);
      const t = 1 - this.attackT / 0.34;
      rShoulder = t < 0.4 ? lerp(-0.1, -2.5, t / 0.4) : lerp(-2.5, -0.3, (t - 0.4) / 0.6);
      rElbow = t < 0.4 ? -0.5 : -0.1;
    }
    this.sR.rotation.z = damp(this.sR.rotation.z, rShoulder, 28, dt || 1);
    this.sL.rotation.z = damp(this.sL.rotation.z, lShoulder, 28, dt || 1);
    this.eR.rotation.z = damp(this.eR.rotation.z, rElbow, 24, dt || 1);
    this.eL.rotation.z = damp(this.eL.rotation.z, lElbow, 24, dt || 1);
    this.head.rotation.z = Math.sin(this.phase * 0.5) * 0.03 * amp + idle * 0.02;
    const flame = this.held?.getObjectByName("flame");
    if (flame) flame.scale.set(1 + Math.sin(this.phase * 9) * 0.1, 1 + Math.sin(this.phase * 13) * 0.18, 1);
  }

  dispose() {
    this.geos.forEach((g) => g.dispose());
    this.ring.geometry.dispose();
    this.ringMat.dispose();
  }
}
