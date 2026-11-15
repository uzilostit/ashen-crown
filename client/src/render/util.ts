import * as THREE from "three";

/** Server coordinates are multiplied by this to get world units. */
export const WORLD_SCALE = 2;
/** Distance from the arena centre to the middle of a hex side (server clamp is +-43). */
export const ARENA_APOTHEM = 86;
/** Distance from the arena centre to a hex corner. Corners sit on the wedge borders. */
export const ARENA_R = ARENA_APOTHEM / Math.cos(Math.PI / 6);
/** The server damages anyone beyond this radius (safeRadius 40). */
export const EDGE_BAND = 80;
export const BASE_R = 14;
export const SPAWN_R = 46;
export const LAYER_T = 0.8;
export const LAYERS = 10;

export const BIOMES = ["marsh", "cinder", "pine", "salt", "frost", "orchard"] as const;
export type Biome = (typeof BIOMES)[number];
export const BIOME_NAMES = ["Marsh", "Cinder Flats", "Pine Forest", "Salt Dunes", "Frost Ridge", "Orchard Ruins"];
export const HAZARD_NAMES = ["flood", "fire", "fire", "fog", "fog", "fog"] as const;

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const damp = (current: number, target: number, lambda: number, dt: number) => lerp(current, target, 1 - Math.exp(-lambda * dt));
export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash2 = (x: number, y: number, seed: number) => {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
export function valueNoise(x: number, y: number, seed = 1) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed), c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
export function fbm(x: number, y: number, seed = 1, octaves = 4) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, y * freq, seed + i * 17) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/** Wedge index 0..5; wedge i spans angles [i*60-30, i*60+30) degrees in the x/z plane. */
export function wedgeOf(x: number, z: number) {
  const a = Math.atan2(z, x);
  return Math.floor((((a + Math.PI / 6) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI / 3)) % 6;
}
export const wedgeCentre = (i: number) => (i * Math.PI) / 3;

/** Signed distance (positive inside) to wedge i intersected with the hex arena. */
export function wedgeDistance(i: number, x: number, z: number) {
  const a0 = i * (Math.PI / 3) - Math.PI / 6, a1 = a0 + Math.PI / 3;
  const d0 = Math.cos(a0) * z - Math.sin(a0) * x;
  const d1 = Math.sin(a1) * x - Math.cos(a1) * z;
  const c = wedgeCentre(i);
  const side = ARENA_APOTHEM - (Math.cos(c) * x + Math.sin(c) * z);
  return Math.min(d0, d1, side);
}

/** Corner points of wedge i's triangle (origin plus two hex corners). */
export function wedgeCorners(i: number): [THREE.Vector2, THREE.Vector2, THREE.Vector2] {
  const a0 = i * (Math.PI / 3) - Math.PI / 6, a1 = a0 + Math.PI / 3;
  return [new THREE.Vector2(0, 0), new THREE.Vector2(Math.cos(a0) * ARENA_R, Math.sin(a0) * ARENA_R), new THREE.Vector2(Math.cos(a1) * ARENA_R, Math.sin(a1) * ARENA_R)];
}

/** Server-space position to world-space. */
export const toWorld = (v: number) => v * WORLD_SCALE;

export function srgb(hex: string) {
  return new THREE.Color(hex);
}
export const mix = (a: string, b: string, t: number) => new THREE.Color(a).lerp(new THREE.Color(b), t);

export const PALETTE: Record<Biome, { low: string; high: string; edge: string; accent: string }> = {
  marsh: { low: "#5d7a63", high: "#8aa27a", edge: "#e9e4cd", accent: "#4f9a98" },
  cinder: { low: "#4a3b38", high: "#9b6246", edge: "#e6d6c2", accent: "#ff8a3d" },
  pine: { low: "#2f5a43", high: "#5e8f5d", edge: "#e3e5d0", accent: "#9ccf88" },
  salt: { low: "#d6c9a6", high: "#f1e8cf", edge: "#faf3df", accent: "#f7f1e1" },
  frost: { low: "#8fb1c6", high: "#e1eff6", edge: "#f1f6f7", accent: "#bfe4f5" },
  orchard: { low: "#a9735c", high: "#d29a7d", edge: "#efe0cc", accent: "#e8828d" },
};

const wedgeHeight = (b: number, x: number, z: number): number => {
  const r = Math.hypot(x, z);
  const n = fbm(x * 0.028, z * 0.028, 7 + b, 4);
  switch (b) {
    case 0: // marsh: low and flat with scattered mounds
      return 0.04 + 0.26 * n + 0.3 * smoothstep(0.6, 0.76, fbm(x * 0.05, z * 0.05, 31, 3));
    case 1: { // cinder flats: ridged cracked plains
      const ridge = 1 - Math.abs(2 * fbm(x * 0.035, z * 0.035, 41, 3) - 1);
      return 0.2 + 0.45 * ridge * ridge + 0.1 * n;
    }
    case 2: // pine forest: rolling hills
      return 0.2 + 0.5 * n + 0.1 * Math.sin(x * 0.06) * Math.cos(z * 0.05);
    case 3: { // salt dunes: long smooth ridges
      const w = 0.5 + 0.5 * Math.sin((x * 0.9 + z * 0.4) * 0.07 + n * 4);
      return 0.18 + 0.36 * w * w + 0.08 * n;
    }
    case 4: // frost ridge: rises toward the rim
      return 0.22 + 0.62 * smoothstep(36, 86, r) * (0.55 + 0.45 * n) + 0.08 * n;
    default: { // orchard ruins: stepped terraces
      const t = 0.26 + 0.34 * n;
      return Math.round(t * 9) / 9 + 0.04 * fbm(x * 0.1, z * 0.1, 5, 2);
    }
  }
};

/** Continuous height 0..1 before quantising into paper layers. */
export function heightField(x: number, z: number) {
  const a = Math.atan2(z, x);
  let sum = 0, wsum = 0;
  for (let b = 0; b < 6; b++) {
    let d = Math.abs(wrapAngle(a - wedgeCentre(b)));
    d = Math.max(0, d - 0.35);
    const w = Math.exp(-(d / 0.32) * (d / 0.32));
    sum += w * wedgeHeight(b, x, z);
    wsum += w;
  }
  let h = sum / Math.max(1e-4, wsum);
  const r = Math.hypot(x, z);
  h = lerp(h, 0.34, smoothstep(BASE_R + 18, BASE_R + 3, r));
  h = lerp(h, 0.3, 1 - smoothstep(0, 3.4, Math.abs(r - SPAWN_R)));
  return clamp(h, 0.03, 0.98);
}

export const layerThreshold = (k: number) => Math.max(0.02, k / LAYERS);
/** Seam inset: layers pull away from wedge and arena edges, giving cut-paper bevels. */
export const SEAM_K = 2.2;

/** Top surface of the stacked paper terrain at a world position. */
export function terrainY(x: number, z: number) {
  const h = Math.min(heightField(x, z), SEAM_K * Math.max(0, wedgeDistance(wedgeOf(x, z), x, z)));
  let level = 0;
  for (let k = 1; k < LAYERS; k++) if (h >= layerThreshold(k)) level = k;
  return LAYER_T * (level + 1);
}
