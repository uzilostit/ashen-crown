import * as THREE from "three";
import { contours } from "d3-contour";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { PaperKit } from "./paper";
import {
  ARENA_R, BIOMES, LAYERS, LAYER_T, PALETTE, SEAM_K, heightField, layerThreshold, mix, mulberry32, terrainY, wedgeCorners, wedgeDistance,
} from "./util";

export interface Terrain {
  group: THREE.Group;
  /** Advance the animated water sheets; flood is 0..1 for the marsh collapse. */
  update(time: number, flood: number): void;
  dispose(): void;
}

function triangleGrid(a: THREE.Vector2, b: THREE.Vector2, c: THREE.Vector2, n: number) {
  const pos: number[] = [], idx: number[] = [];
  const row: number[][] = [];
  for (let i = 0; i <= n; i++) {
    row[i] = [];
    for (let j = 0; j <= n - i; j++) {
      const u = i / n, v = j / n, w = 1 - u - v;
      row[i]![j] = pos.length / 3;
      pos.push(a.x * w + b.x * u + c.x * v, 0, a.y * w + b.y * u + c.y * v);
    }
  }
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n - i; j++) {
      idx.push(row[i]![j]!, row[i + 1]![j]!, row[i]![j + 1]!);
      if (j < n - i - 1) idx.push(row[i + 1]![j]!, row[i + 1]![j + 1]!, row[i]![j + 1]!);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const WATER_Y = LAYER_T * 3.15;

export function buildTerrain(kit: PaperKit, step = 1.6): Terrain {
  const group = new THREE.Group();
  const n = Math.ceil((2 * ARENA_R) / step) + 3;
  const ox = -ARENA_R - step;
  const heights = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) heights[j * n + i] = heightField(ox + i * step, ox + j * step);
  const toWorld = (p: number) => ox + (p - 0.5) * step;
  const rnd = mulberry32(5150);
  const material = kit.mat("#ffffff", { vertexColors: true, repeat: 0.12, normalScale: 0.9 });
  const thresholds = Array.from({ length: LAYERS }, (_, k) => layerThreshold(k));
  const values = new Float64Array(n * n);
  const gen = contours().size([n, n]).thresholds(thresholds);

  for (let w = 0; w < 6; w++) {
    const biome = BIOMES[w]!;
    const pal = PALETTE[biome];
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const sd = wedgeDistance(w, ox + i * step, ox + j * step);
        values[j * n + i] = Math.min(heights[j * n + i]!, SEAM_K * sd);
      }
    const parts: THREE.BufferGeometry[] = [];
    gen(values as unknown as number[]).forEach((mp, k) => {
      const cap = mix(pal.low, pal.high, k / (LAYERS - 1));
      for (const poly of mp.coordinates) {
        const ring = (r: number[][]) => r.map((p) => new THREE.Vector2(toWorld(p[0]!), -toWorld(p[1]!)));
        const shape = new THREE.Shape(ring(poly[0]!));
        for (const hole of poly.slice(1)) shape.holes.push(new THREE.Path(ring(hole)));
        const geo = new THREE.ExtrudeGeometry(shape, { depth: LAYER_T, bevelEnabled: false, curveSegments: 1 });
        geo.rotateX(-Math.PI / 2);
        geo.translate(0, LAYER_T * k, 0);
        const sheet = cap.clone().offsetHSL(0, 0, (rnd() - 0.5) * 0.05);
        const edge = mix(pal.edge, "#" + sheet.getHexString(), 0.14);
        const colors = new Float32Array(geo.attributes.position!.count * 3);
        for (const g of geo.groups) {
          const c = g.materialIndex === 0 ? sheet : edge;
          for (let v = g.start; v < g.start + g.count; v++) c.toArray(colors, v * 3);
        }
        geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        parts.push(geo);
      }
    });
    if (!parts.length) continue;
    const merged = mergeGeometries(parts, false)!;
    parts.forEach((p) => p.dispose());
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.name = `terrain-${biome}`;
    group.add(mesh);
  }

  // Plinth: the diorama stands on a stack of card hexagons.
  const hex = (r: number) => {
    const s = new THREE.Shape();
    for (let i = 0; i < 6; i++) {
      const a = i * (Math.PI / 3) - Math.PI / 6;
      const x = Math.cos(a) * r, y = -Math.sin(a) * r;
      i ? s.lineTo(x, y) : s.moveTo(x, y);
    }
    s.closePath();
    return s;
  };
  const plinth = (r: number, depth: number, y: number, cap: string, side: string) => {
    const g = new THREE.ExtrudeGeometry(hex(r), { depth, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, [kit.mat(cap, { repeat: 0.1 }), kit.mat(side, { repeat: 0.1 })]);
    m.position.y = y;
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  };
  plinth(ARENA_R + 1.5, 3.2, -3.2, "#2a2420", "#7b6a52");
  plinth(ARENA_R + 5, 1.6, -4.8, "#3a2f27", "#a08c6c");
  plinth(ARENA_R + 9, 1.6, -6.4, "#211b17", "#6c5b45");

  // Marsh water: three translucent wavy sheets with offset phases.
  const [a, b, c] = wedgeCorners(0);
  const sheets: { mesh: THREE.Mesh; base: Float32Array; phase: number }[] = [];
  const waterMats: THREE.MeshStandardMaterial[] = [];
  const colors = ["#3f858a", "#58a0a2", "#7ec0bb"];
  const alphas = [0.9, 0.55, 0.38];
  for (let i = 0; i < 3; i++) {
    const geo = triangleGrid(a!, b!, c!, 22);
    const mat = kit.mat(colors[i]!, { transparent: true, opacity: alphas[i], flat: true, roughness: 0.55, repeat: 0.08, normalScale: 0.35, side: THREE.DoubleSide });
    mat.depthWrite = i === 0;
    waterMats.push(mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = WATER_Y + i * 0.1;
    mesh.receiveShadow = true;
    mesh.name = "water";
    sheets.push({ mesh, base: new Float32Array(geo.attributes.position!.array), phase: i * 1.7 });
    group.add(mesh);
  }
  const clean = waterMats.map((m) => m.color.clone());
  const muddy = new THREE.Color("#7a6a46");

  return {
    group,
    update(time, flood) {
      for (const s of sheets) {
        const p = s.mesh.geometry.attributes.position!;
        for (let i = 0; i < p.count; i++) {
          const x = s.base[i * 3]!, z = s.base[i * 3 + 2]!;
          p.setY(i, Math.sin(x * 0.21 + time * 0.9 + s.phase) * 0.07 + Math.cos(z * 0.17 - time * 0.7 + s.phase * 1.3) * 0.06);
        }
        p.needsUpdate = true;
        s.mesh.geometry.computeVertexNormals();
        s.mesh.position.y = WATER_Y + sheets.indexOf(s) * 0.1 + flood * LAYER_T * 3;
      }
      waterMats.forEach((m, i) => m.color.copy(clean[i]!).lerp(muddy, flood * 0.8));
    },
    dispose() {
      group.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose();
      });
    },
  };
}

export { terrainY };
