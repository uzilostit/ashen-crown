import * as THREE from "three";
import type { PaperKit } from "./paper";
import { createFlame } from "./fx";
import { BASE_R, LAYER_T, SPAWN_R, terrainY } from "./util";
import { HEARTH_INFO } from "../content";
import { HEARTHS } from "@ashen-crown/shared";

/** Total height of a paper pedestal, so figures can stand on top of it. */
export const PEDESTAL_H = LAYER_T * 1.5 * 2 + LAYER_T;

export interface Camp {
  group: THREE.Group;
  light: THREE.PointLight;
  update(t: number): void;
  dispose(): void;
}

const hexShape = (r: number) => {
  const s = new THREE.Shape();
  for (let i = 0; i < 6; i++) {
    const a = i * (Math.PI / 3) - Math.PI / 6;
    const x = Math.cos(a) * r, y = -Math.sin(a) * r;
    i ? s.lineTo(x, y) : s.moveTo(x, y);
  }
  s.closePath();
  return s;
};

/** Base Camp: a stepped paper citadel with a brazier, six Hearth banners and the helipad. */
export function buildCamp(kit: PaperKit): Camp {
  const group = new THREE.Group();
  const base = terrainY(0, 0);
  const steps: [number, number, string, string][] = [[BASE_R - 0.3, 1.2, "#b4a07c", "#ece2c8"], [BASE_R - 1.8, 1.4, "#c3ae85", "#f1e8d0"], [BASE_R - 4, 1.4, "#cdb98f", "#f4ecd7"], [BASE_R - 6.2, 1.2, "#d8c59c", "#f7f0de"], [BASE_R - 8.6, 1.0, "#e3d1a8", "#faf4e4"]];
  let y = base - 0.2;
  const geos: THREE.BufferGeometry[] = [];
  for (const [r, h, cap, side] of steps) {
    const g = new THREE.ExtrudeGeometry(hexShape(r), { depth: h, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    geos.push(g);
    const m = new THREE.Mesh(g, [kit.mat(cap, { repeat: 0.12 }), kit.mat(side, { repeat: 0.12 })]);
    m.position.y = y;
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    y += h;
  }
  const top = y;

  // brazier
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.1, 0.9, 8), kit.mat("#403a34", { flat: true }));
  bowl.position.y = top + 0.45;
  bowl.castShadow = true;
  group.add(bowl);
  const flame = createFlame(1.6);
  flame.group.position.y = top + 0.8;
  group.add(flame.group);
  const light = new THREE.PointLight("#ff9a51", 1800, 90, 1.7);
  light.position.y = top + 4;
  group.add(light);
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 2.2, 70, 10, 1, true), new THREE.MeshBasicMaterial({ color: "#ffb15e", transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beacon.position.y = top + 36;
  group.add(beacon);

  // six banners on poles at the hex corners, one per Hearth
  const banners: { geo: THREE.PlaneGeometry; base: Float32Array }[] = [];
  const torches: THREE.Object3D[] = [];
  for (let i = 0; i < 6; i++) {
    const a = i * (Math.PI / 3) - Math.PI / 6, r = BASE_R - 1.1;
    const px = Math.cos(a) * r, pz = Math.sin(a) * r;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 10, 6), kit.mat("#4a3a2c", { flat: true }));
    pole.position.set(px, base + 5, pz);
    pole.castShadow = true;
    group.add(pole);
    const hearth = HEARTHS[(i + 5) % 6]!;
    const col = HEARTH_INFO[hearth].color;
    const geo = new THREE.PlaneGeometry(3.2, 5.2, 4, 8);
    const cloth = new THREE.Mesh(geo, kit.mat(col, { side: THREE.DoubleSide, flat: true, repeat: 0.4 }));
    cloth.position.set(px, base + 6.9, pz);
    cloth.rotation.y = -a + Math.PI / 2;
    cloth.translateX(1.7);
    cloth.castShadow = true;
    group.add(cloth);
    banners.push({ geo, base: new Float32Array(geo.attributes.position!.array) });
    const crest = new THREE.Mesh(new THREE.CircleGeometry(0.8, 8), new THREE.MeshStandardMaterial({ color: "#f3ead4", roughness: 0.9, side: THREE.DoubleSide }));
    crest.position.set(0, 0.4, 0.02);
    cloth.add(crest);
    const t = createFlame(0.32);
    t.group.position.set(px, base + 10, pz);
    group.add(t.group);
    torches.push(t.group);
    (torches as unknown as { f: typeof t[] }).f = ((torches as unknown as { f: typeof t[] }).f ?? []).concat(t);
  }
  const torchFlames = (torches as unknown as { f: ReturnType<typeof createFlame>[] }).f;

  // helipad just outside the citadel wall, where the flare crate lands (server 0,8)
  const pad = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(5.4, 5.6, 0.5, 20), kit.mat("#4a4b52", { repeat: 0.2 }));
  disc.receiveShadow = true;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(4.5, 0.12, 4, 28), new THREE.MeshStandardMaterial({ color: "#f3ead4", roughness: 0.8 }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.3;
  pad.add(disc, ring);
  for (const [w, h, x, z] of [[0.5, 3.2, -1.1, 0], [0.5, 3.2, 1.1, 0], [2.2, 0.5, 0, 0]] as const) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, h), new THREE.MeshStandardMaterial({ color: "#f3ead4", roughness: 0.8 }));
    b.position.set(x, 0.3, z);
    pad.add(b);
  }
  const padLights: THREE.Mesh[] = [];
  for (let i = 0; i < 6; i++) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 4), new THREE.MeshStandardMaterial({ color: "#ff5a3a", emissive: "#ff3a1a", emissiveIntensity: 1.5 }));
    l.position.set(Math.cos(i * Math.PI / 3) * 5.4, 0.45, Math.sin(i * Math.PI / 3) * 5.4);
    padLights.push(l);
    pad.add(l);
  }
  const padY = terrainY(0, 17);
  pad.position.set(0, padY + 0.1, 17);
  group.add(pad);

  return {
    group,
    light,
    update(t) {
      flame.update(t);
      torchFlames.forEach((f, i) => f.update(t, i * 1.7));
      light.intensity = 1700 + Math.sin(t * 11) * 120 + Math.sin(t * 17.3) * 80;
      banners.forEach((b, k) => {
        const p = b.geo.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < p.count; i++) {
          const x = b.base[i * 3]!;
          p.setZ(i, Math.sin(t * 2.4 + x * 1.3 + k) * 0.22 * ((x + 1.6) / 3.2));
        }
        p.needsUpdate = true;
        b.geo.computeVertexNormals();
      });
      padLights.forEach((l, i) => ((l.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.6 + (Math.sin(t * 4 - i) > 0 ? 1.4 : 0)));
    },
    dispose() {
      geos.forEach((g) => g.dispose());
    },
  };
}

/** Six-sided paper pedestals; positions are in world units. */
export function buildPedestals(kit: PaperKit, count: number) {
  const group = new THREE.Group();
  const rnd = (i: number) => i;
  const mats = [kit.mat("#d8cbae", { flat: true }), kit.mat("#c3b392", { flat: true }), kit.mat("#efe5cc", { flat: true })];
  const geos = [new THREE.CylinderGeometry(1.9, 2.15, LAYER_T * 1.5, 6), new THREE.CylinderGeometry(1.6, 1.8, LAYER_T * 1.5, 6), new THREE.CylinderGeometry(1.3, 1.45, LAYER_T, 6)];
  const slots: THREE.Group[] = [];
  for (let i = 0; i < count; i++) {
    const g = new THREE.Group();
    let y = 0;
    geos.forEach((geo, k) => {
      const m = new THREE.Mesh(geo, mats[k]!);
      const h = (geo.parameters as { height: number }).height;
      m.position.y = y + h / 2;
      m.rotation.y = rnd(i) * 0.4 + k * 0.3;
      m.castShadow = m.receiveShadow = true;
      g.add(m);
      y += h;
    });
    g.userData.top = y;
    slots.push(g);
    group.add(g);
  }
  return {
    group,
    /** Place pedestal i at world x,z. */
    place(i: number, x: number, z: number) {
      const g = slots[i];
      if (!g) return 0;
      g.visible = true;
      g.position.set(x, terrainY(x, z), z);
      return g.position.y + (g.userData.top as number);
    },
    hideFrom(n: number) {
      slots.forEach((g, i) => (g.visible = i < n));
    },
    count: count,
    dispose() {
      geos.forEach((g) => g.dispose());
    },
  };
}
export { SPAWN_R };
