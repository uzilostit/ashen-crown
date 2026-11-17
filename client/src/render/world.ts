import * as THREE from "three";
import type { FigureLook, GamePlayer, GameState, Hearth, PlayerView } from "@ashen-crown/shared";
import { buildCamp, buildPedestals, type Camp } from "./camp";
import { buildFlora, type Flora } from "./flora";
import { FogSheets, FlareFx, Hazards, Helicopter, Weather, type WeatherKind } from "./fx";
import { PaperFigure } from "./figure";
import { ITEM_ACCENT, bestWeapon, buildItem } from "./items";
import { PaperKit, cloudTexture } from "./paper";
import { PostStack } from "./post";
import { QualityController, type QualityProfile } from "./quality";
import { buildTerrain, type Terrain } from "./terrain";
import { ARENA_R, SPAWN_R, WORLD_SCALE, clamp, damp, lerp, terrainY, wedgeOf, wrapAngle } from "./util";
import { HEARTH_INFO, skinFor } from "../content";

export type WorldMode = "menu" | "lobby" | "game";
export type WorldEvent =
  | { type: "attack"; id: string; self: boolean; near: boolean }
  | { type: "death"; id: string; near: boolean }
  | { type: "hurt"; self: boolean }
  | { type: "pickup" }
  | { type: "step"; self: boolean };
export interface LabelInfo { id: string; name: string; hearth: Hearth; pos: THREE.Vector3; self: boolean; ally: boolean; dead: boolean; distance: number; allianceId: string | null }

interface Ent {
  id: string;
  fig: PaperFigure;
  hearth: Hearth;
  look: string;
  pos: THREE.Vector3;
  tx: number; tz: number; vx: number; vz: number;
  snapAt: number;
  speed: number;
  facing: number;
  lastStamina: number;
  lastHealth: number;
  alive: boolean;
  escaped: boolean;
  held: string;
  stepClock: number;
}
interface Key { t: number; sky: string; fog: string; sun: string; sunI: number; hemiSky: string; hemiGround: string; hemiI: number; moon: number; tint: string; fogD: number }
const KEYS: Key[] = [
  { t: 0.0, sky: "#e8b894", fog: "#e8b894", sun: "#ff9f6a", sunI: 2.0, hemiSky: "#ffd9b8", hemiGround: "#4c3c3a", hemiI: 0.85, moon: 0, tint: "#ffd2a8", fogD: 0.0042 },
  { t: 0.14, sky: "#bfd3d6", fog: "#c4d5d2", sun: "#ffe7bd", sunI: 2.3, hemiSky: "#e1ecf0", hemiGround: "#4b5a45", hemiI: 0.9, moon: 0, tint: "#fff1dc", fogD: 0.0035 },
  { t: 0.27, sky: "#c9dde4", fog: "#cfdedb", sun: "#fff3da", sunI: 2.5, hemiSky: "#e6f0f4", hemiGround: "#546148", hemiI: 0.95, moon: 0, tint: "#fff7ea", fogD: 0.0032 },
  { t: 0.4, sky: "#e3c79c", fog: "#e1c7a0", sun: "#ffc480", sunI: 2.4, hemiSky: "#ffe6c4", hemiGround: "#514233", hemiI: 0.9, moon: 0, tint: "#ffd9a8", fogD: 0.0038 },
  { t: 0.5, sky: "#d7825a", fog: "#cc8564", sun: "#ff7a3e", sunI: 2.0, hemiSky: "#ffb990", hemiGround: "#3a2d38", hemiI: 0.85, moon: 0.2, tint: "#ffb98a", fogD: 0.0045 },
  { t: 0.6, sky: "#1d2744", fog: "#232f4d", sun: "#4a5a99", sunI: 0, hemiSky: "#5a6c9c", hemiGround: "#181d2c", hemiI: 0.6, moon: 1.15, tint: "#a9bdf0", fogD: 0.0048 },
  { t: 0.88, sky: "#1a2340", fog: "#202b48", sun: "#4a5a99", sunI: 0, hemiSky: "#53659a", hemiGround: "#161b2a", hemiI: 0.56, moon: 1.0, tint: "#a3b6ea", fogD: 0.005 },
  { t: 1.0, sky: "#e8b894", fog: "#e8b894", sun: "#ff9f6a", sunI: 2.0, hemiSky: "#ffd9b8", hemiGround: "#4c3c3a", hemiI: 0.85, moon: 0, tint: "#ffd2a8", fogD: 0.0042 },
];
const c = (s: string) => new THREE.Color(s);
function sampleTod(tod: number) {
  let i = 0;
  while (i < KEYS.length - 2 && tod > KEYS[i + 1]!.t) i++;
  const a = KEYS[i]!, b = KEYS[i + 1]!;
  const k = clamp((tod - a.t) / (b.t - a.t), 0, 1);
  const s = k * k * (3 - 2 * k);
  return {
    sky: c(a.sky).lerp(c(b.sky), s), fog: c(a.fog).lerp(c(b.fog), s), sun: c(a.sun).lerp(c(b.sun), s), sunI: lerp(a.sunI, b.sunI, s),
    hemiSky: c(a.hemiSky).lerp(c(b.hemiSky), s), hemiGround: c(a.hemiGround).lerp(c(b.hemiGround), s), hemiI: lerp(a.hemiI, b.hemiI, s),
    moon: lerp(a.moon, b.moon, s), tint: c(a.tint).lerp(c(b.tint), s), fogD: lerp(a.fogD, b.fogD, s),
  };
}

import { PEDESTAL_H } from "./camp";
const WEATHER_BY_WEDGE: WeatherKind[] = ["spores", "ash", "needles", "salt", "snow", "petals"];

export class World {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(36, 1, 0.5, 1200);
  readonly quality: QualityController;
  mode: WorldMode = "menu";
  listeners: ((e: WorldEvent) => void)[] = [];
  onFrame: ((dt: number) => void) | null = null;

  private kit: PaperKit;
  private terrain: Terrain;
  private flora: Flora;
  private camp: Camp;
  private pedestals;
  private hazards: Hazards;
  private weather = new Weather(900);
  private fog: FogSheets;
  private heli: Helicopter;
  private flare = new FlareFx();
  private post: PostStack;
  private stars: THREE.Points;
  private hemi = new THREE.HemisphereLight("#fff", "#444", 1);
  private sun = new THREE.DirectionalLight("#fff", 3);
  private moon = new THREE.DirectionalLight("#9fb6ff", 0);
  private ents = new Map<string, Ent>();
  private pedCentres: { x: number; z: number }[] = [];
  private lootVis = new Map<string, { g: THREE.Group; ring: THREE.Mesh; phase: number }>();
  private trapVis = new Map<string, THREE.Group>();
  private raf = 0;
  private last = performance.now();
  private t = 0;
  private selfId = "";
  private state: GameState | null = null;
  private stateAt = 0;
  private lobbyPlayers: PlayerView[] = [];
  private roomSize = 0;
  private targetId: string | null = null;
  private timeOfDay = 0.4;
  private elapsedBase = 0;
  private flash = 0;
  private shake = 0;
  private disposed = false;
  private frameDt = 0.016;

  // camera rig
  yaw = 0;
  pitch = 0.5;
  dist = 20;
  private camPos = new THREE.Vector3(0, 40, 80);
  private camLook = new THREE.Vector3();
  private rigReady = false;
  private cut: { until: number; x: number; z: number; r: number } | null = null;
  private free = new THREE.Vector3();
  spectateId: string | null = null;
  freeCam = false;
  private viewOffset = 0;
  private localPose = { block: false, sprint: false };
  private lastWarning: number | null = null;
  private lastCollapsed = 0;

  constructor(host: HTMLElement, quality: QualityController) {
    this.quality = quality;
    const p = quality.profile;
    this.renderer = new THREE.WebGLRenderer({ antialias: quality.tier <= 1, powerPreference: "high-performance", stencil: false });
    this.canvas = this.renderer.domElement;
    this.canvas.className = "world-canvas";
    host.prepend(this.canvas);
    this.renderer.shadowMap.enabled = p.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.kit = new PaperKit(p.texture);
    this.terrain = buildTerrain(this.kit, p.terrainStep);
    this.flora = buildFlora(this.kit);
    this.camp = buildCamp(this.kit);
    this.pedestals = buildPedestals(this.kit, 15);
    const cloud = cloudTexture(128, 11);
    this.hazards = new Hazards(this.kit, cloud);
    this.fog = new FogSheets(cloud, 40, "#ffffff", (r) => { const a = r() * 6.28, d = Math.sqrt(r()) * 95; return [Math.cos(a) * d, Math.sin(a) * d]; }, 4, 11, 30, 9);
    this.heli = new Helicopter(this.kit);

    const stars = new Float32Array(900);
    for (let i = 0; i < 300; i++) {
      const a = Math.random() * 6.28, e = 0.15 + Math.random() * 1.2, r = 520;
      stars.set([Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(stars, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: "#fff6dc", size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.stars.frustumCulled = false;

    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.08;
    this.scene.add(this.terrain.group, this.flora.group, this.camp.group, this.pedestals.group, this.hazards.group, this.fog.mesh, this.weather.points, this.heli.group, this.flare.group, this.stars, this.hemi, this.sun, this.sun.target, this.moon, this.moon.target);
    this.scene.fog = new THREE.FogExp2("#c4d5d2", 0.004);
    this.scene.background = new THREE.Color("#c4d5d2");

    this.post = new PostStack(this.renderer, this.scene, this.camera, innerWidth, innerHeight);
    this.applyProfile(p);
    quality.onChange((pr) => this.applyProfile(pr));
    this.resize();
    addEventListener("resize", this.resize);
    this.last = performance.now();
    this.loop(this.last);
  }

  // ---------- configuration ----------
  private applyProfile(p: QualityProfile) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, p.pixelRatio));
    this.renderer.shadowMap.enabled = p.shadows;
    this.sun.castShadow = p.shadows;
    this.sun.shadow.mapSize.set(p.shadowSize, p.shadowSize);
    this.sun.shadow.map?.dispose();
    (this.sun.shadow as THREE.LightShadow).map = null;
    this.flora.setDensity(p.decor);
    this.weather.setCount(p.particles);
    this.fog.setVisible(p.fogSheets);
    this.camp.light.visible = p.fxLights;
    this.flare.light.visible = p.fxLights;
    this.scene.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m) m.needsUpdate = true; });
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h);
    this.post.configure(p, w * (devicePixelRatio ? Math.min(devicePixelRatio, p.pixelRatio) : 1), h * Math.min(devicePixelRatio || 1, p.pixelRatio));
    if (this.quality.tier <= 1) { (this.post.composer.renderTarget1 as THREE.WebGLRenderTarget).samples = 4; (this.post.composer.renderTarget2 as THREE.WebGLRenderTarget).samples = 4; }
    this.post.composer.setPixelRatio(Math.min(devicePixelRatio || 1, p.pixelRatio));
    this.post.composer.setSize(w, h);
    this.updateShadowFrustum();
  }
  private updateShadowFrustum() {
    const ext = this.mode === "game" ? 60 : 135;
    const c = this.sun.shadow.camera;
    c.left = -ext; c.right = ext; c.top = ext; c.bottom = -ext; c.near = 10; c.far = 420;
    c.updateProjectionMatrix();
  }
  private resize = () => {
    const w = innerWidth, h = innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const p = this.quality.profile;
    this.renderer.setSize(w, h);
    this.post.setSize(w, h);
    this.post.composer.setPixelRatio(Math.min(devicePixelRatio || 1, p.pixelRatio));
    this.updateViewOffset();
  };
  private updateViewOffset() {
    const w = innerWidth, h = innerHeight;
    if (this.mode !== "game" && this.viewOffset !== 0 && w > 900) this.camera.setViewOffset(w, h, -w * this.viewOffset, 0, w, h);
    else this.camera.clearViewOffset();
  }
  setMode(m: WorldMode, offset = 0) {
    if (this.mode !== m) { this.mode = m; this.rigReady = false; this.updateShadowFrustum(); }
    this.viewOffset = offset;
    this.updateViewOffset();
  }

  // ---------- data in ----------
  setLobby(players: PlayerView[], selfId: string) {
    this.selfId = selfId;
    this.lobbyPlayers = players;
    this.roomSize = players.length;
    this.state = null;
    const seen = new Set<string>();
    players.filter((p) => p.connected).forEach((p, i) => {
      seen.add(p.id);
      const a = (i * Math.PI * 2) / Math.max(1, players.length);
      const x = Math.cos(a) * SPAWN_R, z = Math.sin(a) * SPAWN_R;
      const e = this.ent(p.id, p.hearth, p.look);
      e.tx = x; e.tz = z; e.vx = e.vz = 0; e.snapAt = performance.now();
      e.alive = true; e.escaped = false;
      if (e.pos.lengthSq() === 0) e.pos.set(x, 0, z);
      e.held = "dagger";
      e.fig.setHeld("dagger");
      e.fig.object.visible = true;
    });
    for (const [id, e] of this.ents) if (!seen.has(id)) this.removeEnt(id, e);
    this.pedestals.hideFrom(seen.size);
    this.pedCentres = [];
    [...seen].forEach((_, i) => {
      const a = (i * Math.PI * 2) / Math.max(1, players.length);
      this.pedCentres.push({ x: Math.cos(a) * SPAWN_R, z: Math.sin(a) * SPAWN_R });
      this.pedestals.place(i, Math.cos(a) * SPAWN_R, Math.sin(a) * SPAWN_R);
    });
    this.clearLoot();
    this.hazards.update(0, this.t, null, [], this.quality.tier);
  }

  setGame(state: GameState, selfId: string, roomSize: number) {
    this.selfId = selfId;
    const first = this.state === null;
    this.state = state;
    this.stateAt = performance.now();
    this.roomSize = roomSize;
    if (first) { this.elapsedBase = Math.max(0, Date.now() - state.startedAt); this.lastCollapsed = state.zone.collapsed.length; this.lastWarning = state.zone.warningZone; }
    const seen = new Set<string>();
    const me = state.players.find((p) => p.id === selfId);
    state.players.forEach((p, i) => {
      seen.add(p.id);
      const e = this.ent(p.id, p.hearth, p.look);
      const fresh = e.pos.lengthSq() === 0;
      e.tx = p.x * WORLD_SCALE; e.tz = p.z * WORLD_SCALE;
      e.vx = (p.vx ?? 0) * WORLD_SCALE; e.vz = (p.vz ?? 0) * WORLD_SCALE;
      e.snapAt = performance.now();
      if (fresh) e.pos.set(e.tx, 0, e.tz);
      const wasAlive = e.alive;
      e.alive = p.alive; e.escaped = p.escaped;
      if (wasAlive && !p.alive) this.emit({ type: "death", id: p.id, near: !!me && Math.hypot(p.x - me.x, p.z - me.z) < 30 });
      if (p.id === selfId && p.health < e.lastHealth - 0.5 && wasAlive) { this.emit({ type: "hurt", self: true }); this.flash = Math.min(0.5, this.flash + 0.28); this.shake = 0.5; }
      if (p.stamina < e.lastStamina - 6.2 && p.alive) {
        e.fig.strike();
        this.emit({ type: "attack", id: p.id, self: p.id === selfId, near: !me || Math.hypot(p.x - me.x, p.z - me.z) < 36 });
      }
      e.lastStamina = p.stamina; e.lastHealth = p.health;
      const w = bestWeapon(p.inventory);
      const held = p.inventory.some((s) => s.item === "torch") && w === "dagger" ? "torch" : w;
      if (held !== e.held) { e.held = held; e.fig.setHeld(held); }
      const a = (i * Math.PI * 2) / Math.max(1, roomSize);
      this.pedCentres[i] = { x: Math.cos(a) * SPAWN_R, z: Math.sin(a) * SPAWN_R };
      this.pedestals.place(i, Math.cos(a) * SPAWN_R, Math.sin(a) * SPAWN_R);
    });
    for (const [id, e] of this.ents) if (!seen.has(id)) this.removeEnt(id, e);
    this.pedestals.hideFrom(state.players.length);
    this.syncLoot(state);
    this.syncTraps(state);
    // cinematic cuts
    const z = state.zone;
    if (z.warningZone !== null && z.warningZone !== this.lastWarning) this.directorCut(z.warningZone, 4.2);
    if (z.collapsed.length > this.lastCollapsed) this.directorCut(z.collapsed[z.collapsed.length - 1]!, 3.4);
    this.lastWarning = z.warningZone; this.lastCollapsed = z.collapsed.length;
  }

  private ent(id: string, hearth: Hearth, look: string): Ent {
    let e = this.ents.get(id);
    if (e && (e.hearth !== hearth || e.look !== look)) { this.removeEnt(id, e); e = undefined; }
    if (!e) {
      const info = HEARTH_INFO[hearth];
      const fig = new PaperFigure(this.kit, { hearthColor: info.color, accent: info.accent, crest: info.crest, look: look as FigureLook, skin: skinFor(id) });
      this.scene.add(fig.object);
      e = { id, fig, hearth, look, pos: new THREE.Vector3(), tx: 0, tz: 0, vx: 0, vz: 0, snapAt: performance.now(), speed: 0, facing: 1, lastStamina: 100, lastHealth: 100, alive: true, escaped: false, held: "", stepClock: 0 };
      this.ents.set(id, e);
    }
    return e;
  }
  private removeEnt(id: string, e: Ent) {
    this.scene.remove(e.fig.object);
    e.fig.dispose();
    this.ents.delete(id);
  }

  private syncLoot(s: GameState) {
    const ids = new Set(s.loot.map((d) => d.id));
    for (const d of s.loot) {
      if (this.lootVis.has(d.id)) continue;
      const g = new THREE.Group();
      const model = buildItem(this.kit, d.item);
      model.scale.setScalar(1.5);
      model.position.y = 1.3;
      g.add(model);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.25, 20), new THREE.MeshBasicMaterial({ color: ITEM_ACCENT[d.item], transparent: true, opacity: 0.85, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.12;
      g.add(ring);
      if (d.item === "flareGun") {
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.5, 30, 8, 1, true), new THREE.MeshBasicMaterial({ color: "#ff6a50", transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
        beam.position.y = 15;
        g.add(beam);
      }
      const x = d.x * WORLD_SCALE, z = d.z * WORLD_SCALE;
      g.position.set(x, terrainY(x, z), z);
      this.scene.add(g);
      this.lootVis.set(d.id, { g, ring, phase: Math.random() * 6 });
    }
    for (const [id, v] of this.lootVis) if (!ids.has(id)) { this.scene.remove(v.g); this.disposeObject(v.g); this.lootVis.delete(id); this.emit({ type: "pickup" }); }
  }
  private clearLoot() {
    for (const v of this.lootVis.values()) { this.scene.remove(v.g); this.disposeObject(v.g); }
    this.lootVis.clear();
    for (const g of this.trapVis.values()) { this.scene.remove(g); this.disposeObject(g); }
    this.trapVis.clear();
  }
  private syncTraps(s: GameState) {
    const ids = new Set(s.traps.map((tr) => tr.id));
    for (const tr of s.traps) {
      if (this.trapVis.has(tr.id)) continue;
      const g = buildItem(this.kit, "snare");
      g.scale.setScalar(2.6);
      const x = tr.x * WORLD_SCALE, z = tr.z * WORLD_SCALE;
      g.position.set(x, terrainY(x, z) + 0.1, z);
      this.scene.add(g);
      this.trapVis.set(tr.id, g);
    }
    for (const [id, g] of this.trapVis) if (!ids.has(id)) { this.scene.remove(g); this.disposeObject(g); this.trapVis.delete(id); }
  }
  private disposeObject(o: THREE.Object3D) {
    o.traverse((n) => { const m = n as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
  }
  private emit(e: WorldEvent) {
    for (const l of this.listeners) l(e);
  }

  // ---------- control surface ----------
  orbit(dyaw: number, dpitch: number) {
    this.yaw -= dyaw;
    this.pitch = clamp(this.pitch + dpitch, 0.16, 1.2);
  }
  zoom(delta: number) {
    this.dist = clamp(this.dist + delta, 8, 70);
  }
  setLocalPose(p: { block: boolean; sprint: boolean }) { this.localPose = p; }
  setTarget(id: string | null) { this.targetId = id; }
  hitFlash(a = 0.3) { this.flash = Math.min(0.6, this.flash + a); }
  panFree(dx: number, dz: number, dt: number) {
    const sp = 40 * dt;
    this.free.x += (dx * Math.cos(this.yaw) + dz * Math.sin(this.yaw)) * sp;
    this.free.z += (dz * Math.cos(this.yaw) - dx * Math.sin(this.yaw)) * sp;
  }
  directorCut(wedge: number, seconds: number) {
    const a = (wedge * Math.PI) / 3;
    // Players in a fight get the banner but keep their own camera.
    const cinematic = this.cutAllowed();
    if (cinematic) this.cut = { until: performance.now() + seconds * 1000, x: Math.cos(a) * 52, z: Math.sin(a) * 52, r: 62 };
    this.cutListener?.({ kind: "start", wedge, cinematic, seconds });
  }
  cutListener: ((e: { kind: "start"; wedge: number; cinematic: boolean; seconds: number } | { kind: "end" }) => void) | null = null;
  cutAllowed: () => boolean = () => true;
  /** Local, instant strike animation for the player's own figure. */
  strikeSelf() { this.ents.get(this.selfId)?.fig.strike(); }
  /** Which lobby figure the camera stays on (countdown), or null to cycle through everyone. */
  lobbyFocus: string | null = null;
  get cutting() { return !!this.cut; }

  /** Screen position of a world point for HUD labels. */
  project(v: THREE.Vector3, out = new THREE.Vector3()) {
    out.copy(v).project(this.camera);
    return { x: (out.x * 0.5 + 0.5) * innerWidth, y: (-out.y * 0.5 + 0.5) * innerHeight, visible: out.z < 1 && out.z > -1 };
  }
  labels(): LabelInfo[] {
    const me = this.state?.players.find((p) => p.id === this.selfId);
    const list: LabelInfo[] = [];
    const src: { id: string; name: string; hearth: Hearth; allianceId: string | null }[] = this.state ? this.state.players : this.lobbyPlayers.map((p) => ({ ...p, allianceId: null }));
    for (const p of src) {
      const e = this.ents.get(p.id);
      if (!e || !e.fig.object.visible) continue;
      const pos = e.pos.clone();
      pos.y += e.fig.height + 0.7;
      list.push({ id: p.id, name: p.name, hearth: p.hearth, pos, self: p.id === this.selfId, ally: !!me?.allianceId && me.allianceId === p.allianceId, dead: !e.alive, distance: e.pos.distanceTo(this.camera.position), allianceId: p.allianceId });
    }
    return list;
  }
  playerWorld(id: string) { return this.ents.get(id)?.pos; }
  get cameraYaw() { return this.yaw; }
  get tod() { return this.timeOfDay; }

  // ---------- frame loop ----------
  private loop = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dtMs = now - this.last;
    this.last = now;
    const dt = Math.min(0.05, dtMs / 1000);
    this.t += dt;
    this.frameDt = dt;
    this.quality.sample(dtMs);
    this.update(dt, now);
    this.post.render(dt);
    this.onFrame?.(dt);
  };

  private update(dt: number, now: number) {
    const t = this.t;
    const s = this.state;
    // time of day
    this.timeOfDay = s ? ((Date.now() - s.startedAt) / 1000 / 480) % 1 : (0.3 + t * 0.004) % 0.45;
    const sky = sampleTod(this.timeOfDay);
    (this.scene.background as THREE.Color).copy(sky.fog);
    (this.scene.fog as THREE.FogExp2).color.copy(sky.fog);
    (this.scene.fog as THREE.FogExp2).density = sky.fogD * (this.mode === "game" ? 1 : this.mode === "lobby" ? 0.8 : 0.3);
    this.hemi.color.copy(sky.hemiSky); this.hemi.groundColor.copy(sky.hemiGround); this.hemi.intensity = sky.hemiI;
    this.sun.color.copy(sky.sun); this.sun.intensity = sky.sunI;
    this.moon.intensity = sky.moon;
    const dayK = clamp(this.timeOfDay / 0.5, 0, 1);
    const el = Math.max(0.12, Math.sin(Math.PI * dayK) * 1.15), az = lerp(-1.1, 1.1, dayK);
    const sunDir = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el) * 0.8 + 0.25).normalize();
    (this.stars.material as THREE.PointsMaterial).opacity = clamp((sky.moon - 0.2) * 1.2, 0, 1);

    // flash / shake decay
    this.flash = damp(this.flash, 0, 5, dt);
    this.shake = damp(this.shake, 0, 7, dt);

    // entities
    const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion).setY(0).normalize();
    let moving = 0;
    for (const e of this.ents.values()) {
      const age = Math.min(0.15, (now - e.snapAt) / 1000);
      const gx = e.tx + e.vx * age, gz = e.tz + e.vz * age;
      const lam = e.id === this.selfId ? 26 : 18;
      const px = e.pos.x, pz = e.pos.z;
      e.pos.x = damp(e.pos.x, gx, lam, dt); e.pos.z = damp(e.pos.z, gz, lam, dt);
      const gy = terrainY(e.pos.x, e.pos.z) + this.pedestalLift(e.pos.x, e.pos.z);
      e.pos.y = e.pos.y === 0 ? gy : damp(e.pos.y, gy, 16, dt);
      const vx = (e.pos.x - px) / Math.max(dt, 1e-3), vz = (e.pos.z - pz) / Math.max(dt, 1e-3);
      e.speed = damp(e.speed, Math.hypot(vx, vz), 14, dt);
      const alongRight = vx * camRight.x + vz * camRight.z;
      if (e.speed > 1.2) e.facing = alongRight >= 0 ? 1 : -1;
      const f = e.fig;
      f.object.position.copy(e.pos);
      f.billboard.rotation.y = Math.atan2(this.camera.position.x - e.pos.x, this.camera.position.z - e.pos.z);
      const isSelf = e.id === this.selfId;
      f.pose({ speed: e.speed, sprint: e.speed > 7, block: isSelf && this.localPose.block, dead: !e.alive, facing: e.facing }, dt);
      f.object.visible = !e.escaped && (this.mode !== "game" || true);
      const ally = !!s && !!s.players.find((p) => p.id === this.selfId)?.allianceId && s.players.find((p) => p.id === e.id)?.allianceId === s.players.find((p) => p.id === this.selfId)?.allianceId;
      if (!e.alive) f.setMarker(null);
      else if (this.targetId === e.id) f.setMarker("#ff6a50");
      else if (isSelf) f.setMarker("#fff2c4", 0.75);
      else if (ally && !isSelf) f.setMarker("#77d9a0", 0.8);
      else f.setMarker(null);
      f.setPulse(t);
      if (isSelf) { moving = e.speed; e.stepClock += dt * e.speed; if (e.stepClock > 5.2) { e.stepClock = 0; this.emit({ type: "step", self: true }); } }
    }

    // loot bob
    for (const v of this.lootVis.values()) {
      v.g.children[0]!.position.y = 1.3 + Math.sin(t * 2 + v.phase) * 0.22;
      v.g.children[0]!.rotation.y = t * 0.9 + v.phase;
      (v.ring.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(t * 3 + v.phase) * 0.25;
    }

    // world animation
    const zone = s?.zone;
    const flood = this.hazards.update(dt, t, zone?.warningZone ?? null, zone?.collapsed ?? [], this.quality.tier);
    this.terrain.update(t, flood, this.hazards.intensity);
    this.camp.update(t);
    this.fog.update(t);
    this.fog.setStyle(sky.fog.clone().lerp(new THREE.Color("#ffffff"), 0.35), this.mode === "game" ? 0.2 : 0.26);

    // helicopter + flare
    this.updateAir(now, t, s);

    // camera
    const focus = this.updateCamera(dt, now, sunDir, moving);
    // weather follows the biome under the camera focus
    const wedge = wedgeOf(focus.x, focus.z);
    this.weather.setKind(WEATHER_BY_WEDGE[wedge]!);
    this.weather.update(dt, focus, t);

    // light rig follows focus
    const lightDir = sky.moon > sky.sunI * 0.3 ? new THREE.Vector3(-0.4, 0.8, -0.3).normalize() : sunDir;
    this.sun.position.copy(focus).addScaledVector(sunDir, 160);
    this.sun.target.position.copy(focus);
    this.moon.position.copy(focus).addScaledVector(lightDir, 160);
    this.moon.target.position.copy(focus);
    this.camp.light.intensity *= sky.moon > 0.5 ? 1.5 : 1;

    // post grade
    this.post.setGrade(sky.tint, 0.32, t, this.flash);
    this.post.setFocus(this.mode === "game" ? 0.5 : 0.56, this.mode === "game" ? 0.8 : 1.15);
  }

  /** Standing on a pedestal lifts the figure by the pedestal's height. */
  private pedestalLift(x: number, z: number) {
    for (const c of this.pedCentres) if (Math.hypot(x - c.x, z - c.z) < 1.7) return PEDESTAL_H;
    return 0;
  }

  private updateAir(now: number, t: number, s: GameState | null) {
    const fl = s?.flare ?? null;
    this.flare.update(t, !!fl);
    if (fl) {
      const fx = fl.x * WORLD_SCALE, fz = fl.z * WORLD_SCALE;
      this.flare.group.position.set(fx, terrainY(fx, fz), fz);
    }
    const heli = s?.helicopter ?? null;
    if (s && (s.phase === "flare" || s.phase === "helicopter" || (s.phase === "ended" && heli))) {
      const wasHidden = !this.heli.group.visible;
      this.heli.group.visible = true;
      let target = new THREE.Vector3();
      let spin = 1;
      if (fl) target.set(fl.x * WORLD_SCALE, terrainY(fl.x * WORLD_SCALE, fl.z * WORLD_SCALE) + 4.2, fl.z * WORLD_SCALE);
      if (s.phase === "flare" && fl) {
        const p = clamp(1 - (fl.helicopterAt - Date.now()) / 60000, 0, 1);
        const dir = new THREE.Vector3(fl.x, 0, fl.z).normalize();
        if (dir.lengthSq() === 0) dir.set(1, 0, 0);
        const start = new THREE.Vector3(-dir.x * 190, 70, -dir.z * 190).add(target);
        const e = 1 - Math.pow(1 - p, 3);
        this.heli.group.position.lerpVectors(start, target.clone().add(new THREE.Vector3(0, 12, 0)), e);
        this.heli.group.rotation.y = Math.atan2(-(target.z - start.z), target.x - start.x) + Math.PI;
      } else if (s.phase === "helicopter" && heli) {
        const hx = heli.x * WORLD_SCALE, hz = heli.z * WORLD_SCALE;
        const land = new THREE.Vector3(hx, terrainY(hx, hz) + 4.2, hz);
        if (wasHidden) this.heli.group.position.copy(land);
        else this.heli.group.position.lerp(land, 1 - Math.exp(-3 * this.frameDt));
        const rem = (heli.leavesAt - Date.now()) / 1000;
        if (rem < 3) this.heli.group.position.y += (3 - rem) * 2.2 * Math.min(1, this.frameDt * 4);
      } else if (s.phase === "ended" && heli) {
        this.heli.group.position.y += 18 * this.frameDt;
        this.heli.group.position.x += 26 * this.frameDt;
        spin = 1;
      }
      this.heli.update(t, spin);
    } else this.heli.group.visible = false;
  }

  private updateCamera(dt: number, now: number, sunDir: THREE.Vector3, moving: number) {
    const cam = this.camera;
    const focus = new THREE.Vector3();
    let dist = this.dist, pitch = this.pitch, yaw = this.yaw;
    if (this.mode === "game" && this.state) {
      const me = this.ents.get(this.selfId);
      const meState = this.state.players.find((p) => p.id === this.selfId);
      let followPos: THREE.Vector3 | null = null;
      if (meState?.alive && me) followPos = me.pos;
      else if (this.freeCam) { followPos = this.free.clone(); followPos.y = terrainY(this.free.x, this.free.z); }
      else {
        const pick = (this.spectateId && this.ents.get(this.spectateId)) || [...this.ents.values()].find((e) => e.alive && !e.escaped);
        followPos = pick?.pos ?? me?.pos ?? new THREE.Vector3();
        if (this.freeCam === false && pick) this.free.copy(pick.pos);
      }
      focus.set(followPos.x, followPos.y + 2.1, followPos.z);
      if (this.cut) {
        if (now > this.cut.until) { this.cut = null; this.cutListener?.({ kind: "end" }); }
        else { focus.lerp(new THREE.Vector3(this.cut.x, 3, this.cut.z), 0.9); dist = Math.max(dist, this.cut.r); pitch = 0.7; yaw += Math.sin(now * 0.0004) * 0.25; }
      }
    } else if (this.mode === "lobby") {
      const list = [...this.ents.values()];
      const k = list.length ? Math.floor(this.t / 5.5) % list.length : 0;
      const locked = this.lobbyFocus ? this.ents.get(this.lobbyFocus) : undefined;
      const e = locked ?? list[k];
      if (e) {
        focus.set(e.pos.x, e.pos.y + 2.4, e.pos.z);
        yaw = Math.atan2(e.pos.x, e.pos.z) + Math.sin(this.t * 0.25) * 0.5;
        pitch = locked ? 0.3 : 0.36; dist = locked ? 22 : 34;
      } else { yaw = this.t * 0.05; pitch = 0.56; dist = 125; focus.set(0, 3, 0); }
    } else {
      yaw = this.t * 0.025 + 0.4; pitch = 0.5; dist = 275; focus.set(0, 0, 6);
    }
    const hor = Math.cos(pitch) * dist;
    const desired = new THREE.Vector3(focus.x + Math.sin(yaw) * hor, focus.y + Math.sin(pitch) * dist, focus.z + Math.cos(yaw) * hor);
    // keep the camera above the paper layers
    desired.y = Math.max(desired.y, terrainY(desired.x, desired.z) + 3.2);
    if (!this.rigReady) { this.camPos.copy(desired); this.camLook.copy(focus); this.rigReady = true; }
    else { const k = 1 - Math.exp(-dt * (this.cut ? 2.4 : 9)); this.camPos.lerp(desired, k); this.camLook.lerp(focus, k); }
    const sh = this.shake * 0.5;
    cam.position.set(this.camPos.x + (Math.random() - 0.5) * sh, this.camPos.y + (Math.random() - 0.5) * sh, this.camPos.z + (Math.random() - 0.5) * sh);
    cam.lookAt(this.camLook);
    cam.fov = this.mode === "game" ? 38 + Math.min(6, moving * 0.35) : 32;
    cam.updateProjectionMatrix();
    void sunDir;
    return focus;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    removeEventListener("resize", this.resize);
    for (const [id, e] of this.ents) this.removeEnt(id, e);
    this.clearLoot();
    this.terrain.dispose(); this.flora.dispose(); this.camp.dispose(); this.pedestals.dispose();
    this.post.dispose(); this.kit.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}

export { ARENA_R, wrapAngle };
