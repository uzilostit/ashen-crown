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
/** Auto mode never drops below this tier; Minimal is manual only. */
const AUTO_FLOOR = 3;

/**
 * Picks a starting tier from the device, then adapts from measured frame times.
 * Frame times are judged against the display's own refresh interval (a 60 Hz screen can never beat 16.7 ms),
 * start-up hitches are ignored, and a tier that failed once is not retried this session.
 */
export class QualityController {
  tier: number;
  auto: boolean;
  private maxTier: number;
  private frames: number[] = [];
  private since = 0;
  private age = 0;
  private slow = 0;
  private fast = 0;
  private best = Infinity;
  /** Heaviest tier still allowed after a downgrade. */
  private ceiling = 0;
  private lastDown = -Infinity;
  private listeners: ((p: QualityProfile, tier: number) => void)[] = [];

  constructor() {
    const forced = new URLSearchParams(location.search).get("q");
    if (forced !== null) localStorage.setItem(KEY, forced === "auto" ? "auto" : String(Number(forced) || 0));
    const stored = localStorage.getItem(KEY);
    const touch = matchMedia("(pointer:coarse)").matches;
    const big = Math.min(innerWidth, innerHeight) >= 700;
    const detected = touch && !big ? 2 : 1;
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
    this.ceiling = 0;
    this.slow = this.fast = 0;
    this.apply(value === "auto" ? this.maxTier : value);
  }
  private apply(tier: number) {
    const t = Math.max(0, Math.min(PROFILES.length - 1, tier));
    if (t === this.tier) return;
    this.tier = t;
    this.frames.length = 0;
    this.since = 0;
    this.listeners.forEach((l) => l(PROFILES[t]!, t));
  }
  /** Feed each frame's duration in ms. */
  sample(ms: number) {
    if (!this.auto || document.hidden) return;
    this.age += Math.min(ms, 1000);
    if (ms > 250) return; // shader compiles, tab switches and GC pauses are not a verdict on the tier
    this.frames.push(ms);
    this.since += ms;
    if (this.since < 2000) return;
    const sorted = this.frames.slice().sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1]!;
    this.frames.length = 0;
    this.since = 0;
    if (this.age < 6000) return; // warm-up
    this.best = Math.min(this.best, sorted[Math.floor(sorted.length * 0.1)]!);
    const base = Math.min(17.5, Math.max(8, this.best)); // assume a display of at least ~57 Hz
    if (median > base * 1.7 && median > 24) { this.slow++; this.fast = 0; }
    else if (median < base * 1.15) { this.fast++; this.slow = 0; }
    else { this.slow = 0; this.fast = 0; }
    if (this.slow >= 3 && this.tier < AUTO_FLOOR) { this.slow = 0; this.ceiling = this.tier + 1; this.lastDown = this.age; this.apply(this.tier + 1); }
    else if (this.fast >= 8 && this.tier > Math.max(0, this.maxTier - 1) && (this.tier - 1 >= this.ceiling || this.age - this.lastDown > 60_000)) { this.fast = 0; this.apply(this.tier - 1); }
  }
}
