import * as THREE from "three";
import { WORLD_OBSTACLES, type WorldObstacle } from "@ashen-crown/shared";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { PaperKit } from "./paper";
import { ARENA_APOTHEM, ARENA_R, BASE_R, SPAWN_R, WORLD_SCALE, fbm, mix, mulberry32, terrainY, wedgeCorners, wedgeDistance } from "./util";

export interface Flora {
  group: THREE.Group;
  /** 0..1 share of the decorative scatter that stays visible (solid props never thin out). */
  setDensity(f: number): void;
  dispose(): void;
}

type Kind = "pine" | "round" | "deadtree" | "crystalBig" | "shardBig" | "rock" | "ember" | "stump" | "pillar" | "reed" | "grass" | "crystal" | "shard" | "pebble";
interface Inst { x: number; z: number; ry: number; s: number; sy: number; tilt: number; color: THREE.Color }
const SOLID: Kind[] = ["pine", "round", "deadtree", "crystalBig", "shardBig", "rock", "ember", "stump", "pillar"];

const bladeGeo = (w: number, h: number, lean: number) => {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([-w, 0, 0, w, 0, 0, lean * 0.4, h * 0.55, lean * 0.5, w * 0.8, h * 0.55, lean * 0.5, lean, h, lean], 3));
  g.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]);
  g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 0.5, 1, 0.5, 0.5, 1], 2));
  g.computeVertexNormals();
  return g;
};
const shuffle = <T,>(a: T[], rnd: () => number) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
};
const clump = (n: number, h: number, w: number, spread: number, lean: number) => {
  const blades: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const g = bladeGeo(w, h * (0.7 + (i % 3) * 0.2), lean * (0.5 + (i % 2) * 0.5));
    g.rotateY(i * 0.9);
    g.translate(Math.cos(i * 2.1) * spread, 0, Math.sin(i * 2.1) * spread);
    blades.push(g);
  }
  return mergeGeometries(blades)!;
};
const crystalCluster = (r: number, h: number) => {
  const parts: THREE.BufferGeometry[] = [];
  [[0, 0, 1, 0], [0.7, 0.3, 0.7, 0.35], [-0.6, -0.4, 0.6, -0.3], [0.2, -0.8, 0.5, 0.2]].forEach(([x, z, s, t]) => {
    const g = new THREE.OctahedronGeometry(r, 0);
    g.scale(0.5, h * s!, 0.5);
    g.rotateZ(t!);
    g.translate(x! * r * 1.4, h * s! * r * 0.9, z! * r * 1.4);
    parts.push(g);
  });
  return mergeGeometries(parts)!;
};

/** Props for each biome/kind of server obstacle. Tree radius 1.25 server = 2.5 world units. */
function propFor(o: WorldObstacle, rnd: () => number): { kind: Kind; s: number; a: string; b: string } {
  const R = o.radius * WORLD_SCALE;
  if (o.kind === "tree") {
    switch (o.biome) {
      case 0: return { kind: "round", s: R / 1.7, a: "#5f8576", b: "#97b57e" };
      case 1: return { kind: "deadtree", s: R / 1.3, a: "#2b2423", b: "#4d3a35" };
      case 2: return { kind: "pine", s: R / 1.5, a: "#2c5a45", b: "#6f9f62" };
      case 3: return { kind: "crystalBig", s: R / 1.4, a: "#efe8d4", b: "#ffffff" };
      case 4: return { kind: "shardBig", s: R / 1.3, a: "#a9d2ea", b: "#eef8fd" };
      default: return { kind: "round", s: R / 1.7, a: "#7c9a5c", b: "#d4808b" };
    }
  }
  if (o.kind === "rock") {
    if (o.biome === 1 && rnd() < 0.3) return { kind: "ember", s: R / 0.9, a: "#ff7a2e", b: "#ffb347" };
    const tones = [["#66745f", "#8a9a7e"], ["#4b3d38", "#6c5148"], ["#677060", "#8a9078"], ["#cdbf9e", "#e6dbbd"], ["#9eb8c6", "#c9dbe4"], ["#8d7864", "#b19c86"]][o.biome]!;
    return { kind: "rock", s: R / 1.0, a: tones[0]!, b: tones[1]! };
  }
  if (o.biome === 5) return { kind: "pillar", s: R / 0.8, a: "#cdbfa6", b: "#e7dcc6" };
  const tones = [["#6a5a45", "#85704f"], ["#2f2825", "#4a3a35"], ["#6b5238", "#8b6b48"], ["#d8caa6", "#efe3c4"], ["#a8c6d6", "#d6e8f2"]][o.biome]!;
  return { kind: "stump", s: R / 1.0, a: tones[0]!, b: tones[1]! };
}

export function buildFlora(kit: PaperKit, seed = 1337): Flora {
  const rnd = mulberry32(seed);
  const group = new THREE.Group();
  const data = Object.fromEntries((["pine", "round", "deadtree", "crystalBig", "shardBig", "rock", "ember", "stump", "pillar", "reed", "grass", "crystal", "shard", "pebble"] as Kind[]).map((k) => [k, [] as Inst[]])) as Record<Kind, Inst[]>;

  // 1) Solid props sit exactly on the server's collision circles.
  for (const o of WORLD_OBSTACLES) {
    const p = propFor(o, rnd);
    data[p.kind].push({ x: o.x * WORLD_SCALE, z: o.z * WORLD_SCALE, ry: rnd() * 6.28, s: p.s * (0.92 + rnd() * 0.16), sy: 0.9 + rnd() * 0.3, tilt: (rnd() - 0.5) * 0.12, color: mix(p.a, p.b, rnd()) });
  }
  // 2) A rim of large trees and rocks frames the diorama beyond the playable circle (radius 84).
  for (let i = 0; i < 150; i++) {
    const a = rnd() * Math.PI * 2, r = 86 + rnd() * (ARENA_R - 88);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const w = Math.floor((((a + Math.PI / 6) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI / 3)) % 6;
    if (wedgeDistance(w, x, z) < 4) continue;
    const fake: WorldObstacle = { x: x / WORLD_SCALE, z: z / WORLD_SCALE, radius: rnd() < 0.8 ? 1.25 : 0.95, kind: rnd() < 0.8 ? "tree" : "rock", biome: w };
    const p = propFor(fake, rnd);
    data[p.kind].push({ x, z, ry: rnd() * 6.28, s: p.s * (1 + rnd() * 0.5), sy: 1, tilt: 0, color: mix(p.a, p.b, rnd()) });
  }
  // 3) Decorative ground cover players walk through.
  const spot = (w: number, grove: number) => {
    const [, b, c] = wedgeCorners(w);
    for (let tries = 0; tries < 40; tries++) {
      let u = rnd(), v = rnd();
      if (u + v > 1) [u, v] = [1 - u, 1 - v];
      const x = b!.x * u + c!.x * v, z = b!.y * u + c!.y * v;
      const r = Math.hypot(x, z);
      if (r < BASE_R + 2 || r > 84 || wedgeDistance(w, x, z) < 2) continue;
      if (grove < 1 && fbm(x * 0.05, z * 0.05, 91 + w, 3) < 1 - grove) continue;
      return { x, z };
    }
    return null;
  };
  const decor = (k: Kind, w: number, n: number, grove: number, scale: number, a: string, b: string) => {
    for (let i = 0; i < n; i++) {
      const p = spot(w, grove);
      if (p) data[k].push({ ...p, ry: rnd() * 6.28, s: scale * (0.7 + rnd() * 0.7), sy: 0.8 + rnd() * 0.5, tilt: 0, color: mix(a, b, rnd()) });
    }
  };
  decor("reed", 0, 330, 0.7, 1, "#6f8a4b", "#a3b36a");
  decor("grass", 0, 120, 1, 1, "#7a9a5c", "#a8c07a");
  decor("grass", 2, 380, 0.85, 1, "#3f6a4a", "#6f9f62");
  decor("grass", 5, 260, 0.8, 1, "#8fa86a", "#c6b86e");
  decor("grass", 3, 90, 0.6, 0.8, "#c9b98c", "#e6d9b0");
  decor("grass", 1, 110, 0.6, 0.8, "#4a3f38", "#6b4e40");
  decor("crystal", 3, 130, 0.65, 0.8, "#f4efe0", "#ffffff");
  decor("shard", 4, 130, 0.8, 0.8, "#b7dcef", "#eaf7fd");
  for (let w = 0; w < 6; w++) decor("pebble", w, 70, 1, 0.5, "#8a8270", "#b9b09c");

  const trunkMat = kit.mat("#5a4636", { flat: true, repeat: 0.5 });
  const leaf = (o: object = {}) => kit.mat("#ffffff", { flat: true, repeat: 0.5, normalScale: 1, ...o });
  type G = { geo: THREE.BufferGeometry; mat: THREE.Material; extra?: { geo: THREE.BufferGeometry; mat: THREE.Material } };
  const geos: Record<Kind, G> = {
    pine: (() => {
      const tiers: THREE.BufferGeometry[] = [];
      [[1.9, 2.2, 1.5], [1.55, 2.0, 2.6], [1.2, 1.8, 3.6], [0.85, 1.6, 4.5]].forEach(([r, h, y], i) => {
        const c = new THREE.ConeGeometry(r!, h!, 5, 1);
        c.rotateY(i * 0.63);
        c.translate(0, y! + h! / 2 - 0.4, 0);
        tiers.push(c);
      });
      const trunk = new THREE.CylinderGeometry(0.2, 0.3, 2.2, 5);
      trunk.translate(0, 1.1, 0);
      return { geo: mergeGeometries(tiers)!, mat: leaf(), extra: { geo: trunk, mat: trunkMat } };
    })(),
    round: (() => {
      const a = new THREE.IcosahedronGeometry(1.9, 0); a.scale(1, 0.85, 1); a.translate(0, 3.6, 0);
      const b = new THREE.IcosahedronGeometry(1.1, 0); b.translate(1.1, 3.1, 0.6);
      const c = new THREE.IcosahedronGeometry(1.0, 0); c.translate(-1.0, 3.4, -0.7);
      const trunk = new THREE.CylinderGeometry(0.24, 0.36, 2.8, 5); trunk.translate(0, 1.4, 0);
      return { geo: mergeGeometries([a, b, c])!, mat: leaf(), extra: { geo: trunk, mat: trunkMat } };
    })(),
    deadtree: (() => {
      const parts: THREE.BufferGeometry[] = [];
      const t = new THREE.CylinderGeometry(0.16, 0.34, 4.6, 5); t.translate(0, 2.3, 0); parts.push(t);
      [[0.5, 3.0, 0.9, -0.9], [-0.4, 3.6, 0.7, 0.8], [0.2, 4.2, 0.55, -0.4]].forEach(([x, y, l, rz]) => {
        const b = new THREE.CylinderGeometry(0.05, 0.12, l! * 2, 4);
        b.translate(0, l!, 0); b.rotateZ(rz!); b.translate(x! * 0.2, y!, 0); parts.push(b);
      });
      return { geo: mergeGeometries(parts)!, mat: leaf({ roughness: 1 }) };
    })(),
    crystalBig: { geo: crystalCluster(1.0, 3.4), mat: leaf({ roughness: 0.45, emissive: "#fff5dc", emissiveIntensity: 0.14 }) },
    shardBig: { geo: crystalCluster(0.9, 3.9), mat: leaf({ roughness: 0.3, emissive: "#a8dcf5", emissiveIntensity: 0.26 }) },
    rock: { geo: (() => { const g = new THREE.DodecahedronGeometry(1, 0); g.scale(1, 0.72, 0.9); g.translate(0, 0.45, 0); return g; })(), mat: leaf({ roughness: 1 }) },
    ember: { geo: (() => { const g = new THREE.DodecahedronGeometry(0.9, 0); g.scale(1, 0.7, 0.9); g.translate(0, 0.4, 0); return g; })(), mat: leaf({ emissive: "#ff5a14", emissiveIntensity: 0.9 }) },
    stump: { geo: (() => { const g = new THREE.CylinderGeometry(0.85, 1.05, 1.5, 7); g.translate(0, 0.75, 0); const top = new THREE.CylinderGeometry(0.62, 0.62, 0.06, 7); top.translate(0, 1.52, 0); return mergeGeometries([g, top])!; })(), mat: leaf({ roughness: 1 }) },
    pillar: { geo: (() => {
      const a = new THREE.CylinderGeometry(0.7, 0.85, 3.4, 6); a.translate(0, 1.7, 0);
      const cap = new THREE.BoxGeometry(1.8, 0.4, 1.8); cap.translate(0, 3.6, 0);
      return mergeGeometries([a, cap])!;
    })(), mat: leaf({ roughness: 1 }) },
    reed: { geo: clump(7, 2.6, 0.14, 0.35, 0.6), mat: leaf({ side: THREE.DoubleSide }) },
    grass: { geo: clump(6, 0.95, 0.1, 0.22, 0.28), mat: leaf({ side: THREE.DoubleSide }) },
    crystal: { geo: crystalCluster(0.4, 2.2), mat: leaf({ roughness: 0.5, emissive: "#fff5dc", emissiveIntensity: 0.12 }) },
    shard: { geo: crystalCluster(0.4, 2.6), mat: leaf({ roughness: 0.3, emissive: "#a8dcf5", emissiveIntensity: 0.22 }) },
    pebble: { geo: (() => { const g = new THREE.DodecahedronGeometry(0.5, 0); g.scale(1, 0.5, 0.8); return g; })(), mat: leaf({ roughness: 1 }) },
  };

  const meshes: { mesh: THREE.InstancedMesh; max: number; decor: boolean }[] = [];
  const dummy = new THREE.Object3D();
  (Object.keys(data) as Kind[]).forEach((k) => {
    const list = data[k];
    if (!list.length) return;
    const solid = SOLID.includes(k);
    shuffle(list, rnd);
    const parts = [geos[k].geo, geos[k].extra?.geo].filter(Boolean) as THREE.BufferGeometry[];
    const mats = [geos[k].mat, geos[k].extra?.mat].filter(Boolean) as THREE.Material[];
    parts.forEach((geo, pi) => {
      const mesh = new THREE.InstancedMesh(geo, mats[pi]!, list.length);
      mesh.castShadow = solid || k === "reed";
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      list.forEach((it, i) => {
        dummy.position.set(it.x, terrainY(it.x, it.z) - 0.05, it.z);
        dummy.rotation.set(it.tilt * 0.5, it.ry, it.tilt * 0.5);
        dummy.scale.set(it.s, it.s * it.sy, it.s);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, pi === 0 ? it.color : new THREE.Color("#ffffff"));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      meshes.push({ mesh, max: list.length, decor: !solid });
      group.add(mesh);
    });
  });

  return {
    group,
    setDensity(f) {
      for (const m of meshes) if (m.decor) m.mesh.count = Math.max(0, Math.floor(m.max * f));
    },
    dispose() {
      for (const m of meshes) m.mesh.dispose();
      Object.values(geos).forEach((g) => { g.geo.dispose(); g.extra?.geo.dispose(); });
    },
  };
}

export { ARENA_APOTHEM, SPAWN_R };
