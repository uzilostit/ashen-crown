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
  { name: "High", pixelRatio: 1.75, shadows: true, shadowSize: 2048, ao: false, bloom: true, tilt: true, grade: true, decor: 0.9, particles: 700, fogSheets: 30, fxLights: true, terrainStep: 1.4, texture: 512 },
  { name: "Medium", pixelRatio: 1.5, shadows: true, shadowSize: 2048, ao: false, bloom: false, tilt: true, grade: true, decor: 0.7, particles: 450, fogSheets: 18, fxLights: true, terrainStep: 1.5, texture: 512 },
  { name: "Low", pixelRatio: 1.25, shadows: true, shadowSize: 1024, ao: false, bloom: false, tilt: true, grade: true, decor: 0.45, particles: 250, fogSheets: 8, fxLights: true, terrainStep: 1.7, texture: 512 },
  { name: "Minimal", pixelRatio: 1, shadows: false, shadowSize: 512, ao: false, bloom: false, tilt: false, grade: false, decor: 0.25, particles: 120, fogSheets: 4, fxLights: false, terrainStep: 2.0, texture: 256 },
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
    const touch = matchMedia("(pointer:coarse)").matches;
    const big = Math.min(innerWidth, innerHeight) >= 700; // tablets and large screens
    const weak = (navigator.hardwareConcurrency ?? 8) <= 4;
    // Everything starts on the full-look tiers; the frame-time scaler steps down within seconds if the device struggles.
    const detected = touch ? (big ? 1 : 2) : weak ? 1 : 1;
    this.auto = stored === null || stored === "auto";
    this.tier = this.auto ? detected : Math.max(0, Math.min(PROFILES.length - 1, Number(stored) || 0));
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
    const t = Math.max(0, Math.min(PROFILES.length - 1, tier));
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
    else if (this.fast >= 3 && this.tier > Math.max(0, this.maxTier - 2)) { this.fast = 0; this.apply(this.tier - 1); }
  }
}
