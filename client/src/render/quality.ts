export interface QualityProfile {
  name: string;
  pixelRatio: number;
  shadows: boolean;
  shadowSize: number;
  ao: boolean;
  bloom: boolean;
  tilt: boolean;
  grade: boolean;
  decor: number;
  particles: number;
  fogSheets: number;
  fxLights: boolean;
  terrainStep: number;
  texture: number;
}

/** Tier 0 is richest. Terrain detail and texture size are fixed when the world is built. */
export const PROFILES: QualityProfile[] = [
  { name: "Ultra", pixelRatio: 2, shadows: true, shadowSize: 4096, ao: true, bloom: true, tilt: true, grade: true, decor: 1, particles: 900, fogSheets: 40, fxLights: true, terrainStep: 1.25, texture: 1024 },
  { name: "High", pixelRatio: 1.6, shadows: true, shadowSize: 2048, ao: false, bloom: true, tilt: true, grade: true, decor: 0.85, particles: 650, fogSheets: 28, fxLights: true, terrainStep: 1.5, texture: 512 },
  { name: "Medium", pixelRatio: 1.25, shadows: true, shadowSize: 1024, ao: false, bloom: false, tilt: true, grade: true, decor: 0.55, particles: 380, fogSheets: 14, fxLights: true, terrainStep: 1.9, texture: 512 },
  { name: "Low", pixelRatio: 1, shadows: false, shadowSize: 512, ao: false, bloom: false, tilt: false, grade: false, decor: 0.25, particles: 160, fogSheets: 5, fxLights: false, terrainStep: 2.4, texture: 256 },
];

const KEY = "ashen-crown-quality";

/** Picks a starting tier from the device, then steps up or down from measured frame times. */
export class QualityController {
  tier: number;
  auto: boolean;
  private maxTier: number;
  private frames: number[] = [];
  private since = 0;
  private slow = 0;
  private fast = 0;
  private listeners: ((p: QualityProfile, tier: number) => void)[] = [];

  constructor() {
    const stored = localStorage.getItem(KEY);
    const coarse = matchMedia("(pointer:coarse)").matches || innerWidth < 720;
    const weak = (navigator.hardwareConcurrency ?? 8) <= 4;
    const detected = coarse ? 3 : weak ? 2 : 1;
    this.auto = stored === null || stored === "auto";
    this.tier = this.auto ? detected : Math.max(0, Math.min(3, Number(stored)));
    this.maxTier = detected;
  }
  get profile() {
    return PROFILES[this.tier]!;
  }
  onChange(cb: (p: QualityProfile, tier: number) => void) {
    this.listeners.push(cb);
  }
  set(value: "auto" | number) {
    this.auto = value === "auto";
    localStorage.setItem(KEY, String(value));
    if (value !== "auto") this.apply(value);
    else this.apply(this.maxTier);
  }
  private apply(tier: number) {
    const t = Math.max(0, Math.min(3, tier));
    if (t === this.tier) return;
    this.tier = t;
    this.frames.length = 0;
    this.listeners.forEach((l) => l(PROFILES[t]!, t));
  }
  /** Feed each frame's duration in ms. */
  sample(ms: number) {
    if (!this.auto || ms > 500) return;
    this.frames.push(ms);
    this.since += ms;
    if (this.since < 2000) return;
    const avg = this.frames.reduce((a, b) => a + b, 0) / Math.max(1, this.frames.length);
    this.frames.length = 0;
    this.since = 0;
    if (avg > 27) { this.slow++; this.fast = 0; } else if (avg < 15) { this.fast++; this.slow = 0; } else { this.slow = 0; this.fast = 0; }
    if (this.slow >= 2) { this.slow = 0; this.apply(this.tier + 1); }
    else if (this.fast >= 6 && this.tier > Math.max(0, this.maxTier - 2)) { this.fast = 0; this.apply(this.tier - 1); }
  }
}
