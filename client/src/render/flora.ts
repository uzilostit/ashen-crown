import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { PaperKit } from "./paper";
import { BASE_R, PALETTE, SPAWN_R, fbm, mix, mulberry32, terrainY, wedgeCorners, wedgeDistance } from "./util";

export interface Flora {
  group: THREE.Group;
  /** 0..1 share of every scatter kind that stays visible (quality scaler). */
  setDensity(f: number): void;
  dispose(): void;
}

interface Inst { x: number; y: number; z: number; ry: number; s: number; sy: number; tilt: number; color: THREE.Color }
type Kind = "pine" | "round" | "spike" | "reed" | "rock" | "crystal" | "shard" | "pillar" | "block" | "ember";

const bladeGeo = (w: number, h: number, lean: number) => {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([-w, 0, 0, w, 0, 0, lean * 0.4, h * 0.55, lean * 0.5, w * 0.8, h * 0.55, lean * 0.5, lean, h, lean], 3));
  g.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]);
  g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 0.5, 1, 0.5, 0.5, 1], 2));
  g.computeVertexNormals();
  return g;
};

function shuffle<T>(a: T[], rnd: () => number) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
}

export function buildFlora(kit: PaperKit, seed = 1337): Flora {
  const rnd = mulberry32(seed);
  const group = new THREE.Group();
  const data: Record<Kind, Inst[]> = { pine: [], round: [], spike: [], reed: [], rock: [], crystal: [], shard: [], pillar: [], block: [], ember: [] };

  const spot = (w: number, grove: number, scale: number) => {
    const [, b, c] = wedgeCorners(w);
    for (let tries = 0; tries < 60; tries++) {
      let u = rnd(), v = rnd();
      if (u + v > 1) [u, v] = [1 - u, 1 - v];
      const x = b!.x * u + c!.x * v, z = b!.y * u + c!.y * v;
      const r = Math.hypot(x, z);
      if (r < BASE_R + 5 || Math.abs(r - SPAWN_R) < 3.6 || wedgeDistance(w, x, z) < 3.5) continue;
      if (grove < 1 && fbm(x * 0.045, z * 0.045, 91 + w, 3) < 1 - grove) continue;
      return { x, y: terrainY(x, z), z, ry: rnd() * Math.PI * 2, s: scale * (0.75 + rnd() * 0.75), sy: 0.85 + rnd() * 0.5, tilt: (rnd() - 0.5) * 0.25 };
    }
    return null;
  };
  const add = (k: Kind, w: number, n: number, grove: number, scale: number, color: (t: number) => THREE.Color) => {
    for (let i = 0; i < n; i++) {
      const p = spot(w, grove, scale);
      if (p) data[k].push({ ...p, color: color(rnd()) });
    }
  };
  const tone = (a: string, b: string) => (t: number) => mix(a, b, t);

  // marsh (0), cinder (1), pine (2), salt (3), frost (4), orchard (5)
  add("reed", 0, 300, 0.7, 1, tone("#6f8a4b", "#a3b36a"));
  add("rock", 0, 36, 1, 1.1, tone("#6a7660", "#8e9a80"));
  add("spike", 1, 150, 0.8, 1, tone("#2b2423", "#4a3835"));
  add("rock", 1, 90, 1, 1.3, tone("#4b3d38", "#6c5148"));
  add("ember", 1, 34, 1, 1, tone("#ff7a2e", "#ffb347"));
  add("pine", 2, 420, 0.75, 1.15, tone(PALETTE.pine.low, "#74a566"));
  add("rock", 2, 46, 1, 1.2, tone("#677060", "#8a9078"));
  add("crystal", 3, 130, 0.65, 1.1, tone("#f4efe0", "#ffffff"));
  add("rock", 3, 50, 1, 1.2, tone("#cdbf9e", "#e6dbbd"));
  add("shard", 4, 130, 0.8, 1.2, tone("#b7dcef", "#eaf7fd"));
  add("pine", 4, 60, 0.6, 0.9, tone("#cfe0e6", "#f2f8fa"));
  add("rock", 4, 60, 1, 1.3, tone("#9eb8c6", "#c9dbe4"));
  add("round", 5, 100, 0.7, 1.1, tone("#6d8f55", "#c97a85"));
  add("pillar", 5, 34, 0.9, 1, tone("#cdbfa6", "#e7dcc6"));
  add("block", 5, 46, 1, 1, tone("#b9ab92", "#dcceb4"));
  add("rock", 5, 26, 1, 1, tone("#8d7864", "#b19c86"));

  const trunkMat = kit.mat("#5a4636", { flat: true, repeat: 0.5 });
  const leaf = (o: object = {}) => kit.mat("#ffffff", { flat: true, repeat: 0.5, normalScale: 1, ...o });
  const geos: Record<Kind, { geo: THREE.BufferGeometry; mat: THREE.Material; extra?: { geo: THREE.BufferGeometry; mat: THREE.Material } }> = {
    pine: (() => {
      const tiers: THREE.BufferGeometry[] = [];
      [[1.9, 2.2, 1.5], [1.55, 2.0, 2.6], [1.2, 1.8, 3.6], [0.85, 1.6, 4.5]].forEach(([r, h, y], i) => {
        const c = new THREE.ConeGeometry(r!, h!, 5, 1);
        c.rotateY(i * 0.63);
        c.translate(0, y! + h! / 2 - 0.4, 0);
        tiers.push(c);
      });
      const trunk = new THREE.CylinderGeometry(0.18, 0.28, 2, 5);
      trunk.translate(0, 1, 0);
      return { geo: mergeGeometries(tiers)!, mat: leaf(), extra: { geo: trunk, mat: trunkMat } };
    })(),
    round: (() => {
      const a = new THREE.IcosahedronGeometry(1.9, 0); a.scale(1, 0.85, 1); a.translate(0, 3.6, 0);
      const b = new THREE.IcosahedronGeometry(1.1, 0); b.translate(1.1, 3.1, 0.6);
      const c = new THREE.IcosahedronGeometry(1.0, 0); c.translate(-1.0, 3.4, -0.7);
      const trunk = new THREE.CylinderGeometry(0.22, 0.34, 2.6, 5); trunk.translate(0, 1.3, 0);
      return { geo: mergeGeometries([a, b, c])!, mat: leaf(), extra: { geo: trunk, mat: trunkMat } };
    })(),
    spike: { geo: (() => { const g = new THREE.ConeGeometry(0.4, 4.2, 4, 1); g.translate(0, 2.1, 0); return g; })(), mat: leaf({ roughness: 1 }) },
    reed: (() => {
      const blades: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 7; i++) {
        const g = bladeGeo(0.14, 2.6 + (i % 3) * 0.7, 0.5 + (i % 2) * 0.4);
        g.rotateY(i * 0.9);
        g.translate(Math.cos(i * 2.1) * 0.35, 0, Math.sin(i * 2.1) * 0.35);
        blades.push(g);
      }
      return { geo: mergeGeometries(blades)!, mat: leaf({ side: THREE.DoubleSide }) };
    })(),
    rock: { geo: (() => { const g = new THREE.DodecahedronGeometry(1, 0); g.scale(1, 0.62, 0.86); g.translate(0, 0.25, 0); return g; })(), mat: leaf({ roughness: 1 }) },
    ember: { geo: (() => { const g = new THREE.DodecahedronGeometry(0.8, 0); g.scale(1, 0.5, 0.9); g.translate(0, 0.15, 0); return g; })(), mat: leaf({ emissive: "#ff5a14", emissiveIntensity: 0.9 }) },
    crystal: { geo: (() => { const g = new THREE.OctahedronGeometry(0.8, 0); g.scale(0.55, 2.4, 0.55); g.translate(0, 1.6, 0); return g; })(), mat: leaf({ roughness: 0.5, emissive: "#fff5dc", emissiveIntensity: 0.12 }) },
    shard: { geo: (() => { const g = new THREE.ConeGeometry(0.55, 3.8, 4, 1); g.translate(0, 1.9, 0); return g; })(), mat: leaf({ roughness: 0.35, emissive: "#a8dcf5", emissiveIntensity: 0.22 }) },
    pillar: { geo: (() => {
      const a = new THREE.CylinderGeometry(0.75, 0.85, 3.6, 6); a.translate(0, 1.8, 0);
      const cap = new THREE.BoxGeometry(1.9, 0.4, 1.9); cap.translate(0, 3.8, 0);
      return mergeGeometries([a, cap])!;
    })(), mat: leaf({ roughness: 1 }) },
    block: { geo: (() => { const g = new THREE.BoxGeometry(1.8, 0.8, 1.0); g.translate(0, 0.4, 0); return g; })(), mat: leaf({ roughness: 1 }) },
  };

  const meshes: { mesh: THREE.InstancedMesh; max: number }[] = [];
  const dummy = new THREE.Object3D();
  (Object.keys(data) as Kind[]).forEach((k) => {
    const list = data[k];
    if (!list.length) return;
    shuffle(list, rnd);
    const parts = [geos[k].geo, geos[k].extra?.geo].filter(Boolean) as THREE.BufferGeometry[];
    const mats = [geos[k].mat, geos[k].extra?.mat].filter(Boolean) as THREE.Material[];
    parts.forEach((geo, pi) => {
      const mesh = new THREE.InstancedMesh(geo, mats[pi]!, list.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      list.forEach((it, i) => {
        dummy.position.set(it.x, it.y - 0.05, it.z);
        dummy.rotation.set(k === "pillar" ? it.tilt * 1.4 : it.tilt * 0.4, it.ry, k === "pillar" ? it.tilt : it.tilt * 0.4);
        dummy.scale.set(it.s, it.s * it.sy, it.s);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        // trunks keep one brown instance colour; foliage and stone use the biome tone
        mesh.setColorAt(i, pi === 0 ? it.color : new THREE.Color("#ffffff"));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      meshes.push({ mesh, max: list.length });
      group.add(mesh);
    });
  });

  return {
    group,
    setDensity(f) {
      for (const m of meshes) m.mesh.count = Math.max(0, Math.floor(m.max * f));
    },
    dispose() {
      for (const m of meshes) m.mesh.dispose();
      Object.values(geos).forEach((g) => { g.geo.dispose(); g.extra?.geo.dispose(); });
    },
  };
}
