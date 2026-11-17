/** Fully synthesised audio: paper rustles and tears, a generative score that follows the match phase. */
export type MusicPhase = "menu" | "lobby" | "countdown" | "day" | "night" | "danger" | "escape" | "end" | "silent";

interface Settings { master: number; music: number; sfx: number; muted: boolean }
const KEY = "ashen-crown-audio";
const load = (): Settings => {
  try { return { master: 0.8, music: 0.55, sfx: 0.9, muted: false, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") }; } catch { return { master: 0.8, music: 0.55, sfx: 0.9, muted: false }; }
};

const SCALES: Record<string, number[]> = { minor: [0, 3, 5, 7, 10], dorian: [0, 2, 3, 7, 9], major: [0, 2, 4, 7, 9], phrygian: [0, 1, 5, 7, 8] };
const PHASES: Record<MusicPhase, { root: number; scale: string; tempo: number; density: number; drone: number; pulse: boolean; bright: number }> = {
  menu: { root: 55, scale: "dorian", tempo: 2.4, density: 0.55, drone: 0.5, pulse: false, bright: 700 },
  lobby: { root: 55, scale: "dorian", tempo: 2.0, density: 0.6, drone: 0.5, pulse: false, bright: 800 },
  countdown: { root: 49, scale: "phrygian", tempo: 1.1, density: 0.5, drone: 0.7, pulse: true, bright: 900 },
  day: { root: 73.4, scale: "minor", tempo: 1.9, density: 0.4, drone: 0.4, pulse: false, bright: 900 },
  night: { root: 55, scale: "minor", tempo: 2.8, density: 0.25, drone: 0.55, pulse: false, bright: 450 },
  danger: { root: 49, scale: "phrygian", tempo: 0.9, density: 0.5, drone: 0.8, pulse: true, bright: 1100 },
  escape: { root: 65.4, scale: "minor", tempo: 0.55, density: 0.85, drone: 0.7, pulse: true, bright: 1500 },
  end: { root: 65.4, scale: "major", tempo: 2.6, density: 0.4, drone: 0.5, pulse: false, bright: 900 },
  silent: { root: 55, scale: "minor", tempo: 3, density: 0, drone: 0, pulse: false, bright: 400 },
};

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private noise!: AudioBuffer;
  private reverb!: ConvolverNode;
  private drone: { gain: GainNode; filter: BiquadFilterNode; oscs: OscillatorNode[] } | null = null;
  private phase: MusicPhase = "silent";
  private timer = 0;
  private nextNote = 0;
  private nextPulse = 0;
  private melodyStep = 0;
  settings = load();
  private heli: { gain: GainNode } | null = null;

  /** Must be called from a user gesture the first time. */
  start() {
    if (this.ctx) { void this.ctx.resume(); return; }
    const ctx = (this.ctx = new AudioContext());
    this.master = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // short synthetic room impulse for the score
    const ir = ctx.createBuffer(2, ctx.sampleRate * 1.8, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ch.length, 2.8);
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = ir;
    const rg = ctx.createGain();
    rg.gain.value = 0.45;
    this.reverb.connect(rg).connect(this.musicBus);
    this.applySettings();
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 500;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.musicBus);
    filter.connect(gain);
    const oscs = [0, 1, 2].map((i) => {
      const o = ctx.createOscillator();
      o.type = i === 2 ? "triangle" : "sine";
      o.frequency.value = PHASES.menu.root * (i === 1 ? 1.5 : 1);
      o.detune.value = i * 4 - 4;
      o.connect(filter);
      o.start();
      return o;
    });
    this.drone = { gain, filter, oscs };
    this.timer = window.setInterval(() => this.schedule(), 120);
    this.setPhase(this.phase === "silent" ? "menu" : this.phase);
  }

  private applySettings() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.settings.muted ? 0 : this.settings.master, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.settings.music * 0.6, t, 0.1);
    this.sfxBus.gain.setTargetAtTime(this.settings.sfx, t, 0.05);
  }
  set(patch: Partial<Settings>) {
    this.settings = { ...this.settings, ...patch };
    localStorage.setItem(KEY, JSON.stringify(this.settings));
    this.applySettings();
  }

  setPhase(p: MusicPhase) {
    this.phase = p;
    if (!this.ctx || !this.drone) return;
    const cfg = PHASES[p], t = this.ctx.currentTime;
    this.drone.gain.gain.setTargetAtTime(cfg.drone * 0.35, t, 1.2);
    this.drone.filter.frequency.setTargetAtTime(cfg.bright * 0.6, t, 1.5);
    this.drone.oscs.forEach((o, i) => o.frequency.setTargetAtTime(cfg.root * (i === 1 ? 1.5 : 1), t, 1.8));
  }

  private schedule() {
    const ctx = this.ctx;
    if (!ctx || this.phase === "silent" || this.settings.muted) return;
    const cfg = PHASES[this.phase], now = ctx.currentTime;
    if (now >= this.nextNote) {
      this.nextNote = now + cfg.tempo * (0.6 + Math.random() * 0.8);
      if (Math.random() < cfg.density) {
        const sc = SCALES[cfg.scale]!;
        this.melodyStep = Math.max(-3, Math.min(9, this.melodyStep + Math.floor(Math.random() * 5) - 2));
        const deg = ((this.melodyStep % sc.length) + sc.length) % sc.length, oct = Math.floor(this.melodyStep / sc.length);
        this.bell(cfg.root * 4 * Math.pow(2, sc[deg]! / 12 + oct), cfg.bright);
      }
    }
    if (cfg.pulse && now >= this.nextPulse) {
      this.nextPulse = now + cfg.tempo * 0.55;
      this.thump(cfg.root * 0.9, 0.5);
    }
  }
  private bell(freq: number, bright: number) {
    const ctx = this.ctx!, t = ctx.currentTime;
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = "triangle"; o2.type = "sine";
    o.frequency.value = freq; o2.frequency.value = freq * 2.01;
    f.type = "lowpass"; f.frequency.value = bright * 2;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 2.6);
    o.connect(f); o2.connect(f); f.connect(g);
    g.connect(this.musicBus); g.connect(this.reverb);
    o.start(t); o2.start(t); o.stop(t + 2.8); o2.stop(t + 2.8);
  }
  private thump(freq: number, vol: number) {
    const ctx = this.ctx!, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(freq * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.55, t + 0.25);
    g.gain.setValueAtTime(vol * 0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    o.connect(g).connect(this.musicBus);
    o.start(t); o.stop(t + 0.45);
  }

  // ---------- effects ----------
  private burst(dur: number, type: BiquadFilterType, f0: number, f1: number, vol: number, q = 1, bus: AudioNode = this.sfxBus, delay = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = this.noise; src.loop = true;
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + Math.min(0.02, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    src.connect(f).connect(g).connect(bus);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }
  private tone(freq: number, dur: number, vol: number, type: OscillatorType = "sine", glide = 0, delay = 0) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * glide), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g).connect(this.sfxBus);
    o.start(t); o.stop(t + dur + 0.05);
  }
  click() { this.burst(0.05, "highpass", 3000, 5000, 0.25); this.tone(640, 0.06, 0.08, "triangle"); }
  rustle(vol = 0.35) { this.burst(0.14, "bandpass", 2400, 4200, vol, 0.8); }
  step() { this.burst(0.07, "bandpass", 1500, 900, 0.1, 0.9); }
  tear(vol = 0.5) { this.burst(0.28, "bandpass", 1200, 4800, vol, 1.4); this.burst(0.2, "highpass", 5000, 2500, vol * 0.5, 1, this.sfxBus, 0.04); }
  hit(self = false) { this.tear(self ? 0.8 : 0.45); this.thump(70, self ? 0.9 : 0.4); }
  swing() { this.burst(0.18, "bandpass", 700, 2600, 0.25, 0.7); }
  pickup() { this.rustle(0.4); this.tone(880, 0.12, 0.1, "sine", 1, 0.04); this.tone(1320, 0.16, 0.09, "sine", 1, 0.1); }
  emote() { this.tone(520, 0.1, 0.1, "triangle"); this.tone(780, 0.14, 0.1, "triangle", 1, 0.08); }
  cannon() { this.tone(95, 1.2, 0.9, "sine", 0.35); this.burst(0.9, "lowpass", 900, 80, 0.8); }
  siren(seconds = 3) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = "sawtooth"; o.frequency.value = 640;
    lfo.frequency.value = 0.9; lg.gain.value = 170;
    lfo.connect(lg).connect(o.frequency);
    f.type = "lowpass"; f.frequency.value = 1400;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.3);
    g.gain.setValueAtTime(0.16, t + seconds - 0.5);
    g.gain.linearRampToValueAtTime(0, t + seconds);
    o.connect(f).connect(g).connect(this.sfxBus);
    o.start(t); lfo.start(t); o.stop(t + seconds); lfo.stop(t + seconds);
  }
  flare() { this.burst(1.1, "highpass", 600, 5200, 0.5); this.burst(2.2, "bandpass", 3000, 2000, 0.25, 2, this.sfxBus, 0.3); }
  collapse() { this.cannon(); this.tear(0.6); }
  gong() { this.tone(180, 2.4, 0.4, "sine"); this.tone(272, 2.2, 0.2, "sine", 1, 0.02); this.tone(361, 1.8, 0.15, "triangle", 1, 0.02); }
  tick(urgent = false) { this.tone(urgent ? 1200 : 900, 0.07, 0.12, "square"); }
  heartbeat() { this.thump(60, 0.9); setTimeout(() => this.thump(52, 0.6), 190); }
  helicopter(on: boolean, near = 1) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!on) { this.heli?.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.4); return; }
    if (!this.heli) {
      const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), am = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
      src.buffer = this.noise; src.loop = true;
      f.type = "lowpass"; f.frequency.value = 260;
      am.gain.value = 0.5;
      lfo.type = "square"; lfo.frequency.value = 12; lg.gain.value = 0.5;
      lfo.connect(lg).connect(am.gain);
      g.gain.value = 0;
      src.connect(f).connect(am).connect(g).connect(this.sfxBus);
      src.start(); lfo.start();
      this.heli = { gain: g };
    }
    this.heli.gain.gain.setTargetAtTime(0.5 * Math.min(1, near), ctx.currentTime, 0.5);
  }
  dispose() {
    clearInterval(this.timer);
    void this.ctx?.close();
    this.ctx = null;
  }
}

export const audio = new AudioEngine();
