import * as THREE from "three";
import type { FigureLook, Hearth, ItemId } from "@ashen-crown/shared";
import { PaperFigure } from "../render/figure";
import { buildItem } from "../render/items";
import { PaperKit } from "../render/paper";
import { HEARTH_INFO, itemName, skinFor } from "../content";
import { ITEM_ACCENT } from "../render/items";
import { reportDiag } from "../diag";

/**
 * Photographs paper models (hotbar icons, character preview) using the game's own renderer and an offscreen target.
 * Browsers with strict WebGL (Brave Shields) lose the main context if a second one is created, so we never make one.
 */
class Studio {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(26, 1, 0.1, 100);
  readonly kit = new PaperKit(256);
  private icons = new Map<ItemId, string>();
  private fig: { key: string; f: PaperFigure } | null = null;
  private targets = new Map<string, THREE.WebGLRenderTarget>();
  private scratch = document.createElement("canvas");
  private lastAvatar = 0;

  constructor(private renderer: THREE.WebGLRenderer) {
    this.scene.add(new THREE.HemisphereLight("#fff4e0", "#5a5048", 1.5));
    const key = new THREE.DirectionalLight("#fff0d4", 2.2);
    key.position.set(-3, 5, 6);
    this.scene.add(key);
  }

  private target(w: number, h: number) {
    const k = `${w}x${h}`;
    let t = this.targets.get(k);
    if (!t) {
      t = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, samples: 4, depthBuffer: true });
      t.texture.colorSpace = THREE.SRGBColorSpace;
      this.targets.set(k, t);
    }
    return t;
  }

  /** Render the studio scene to RGBA pixels (top row first, straight alpha). */
  private shoot(w: number, h: number): ImageData {
    const r = this.renderer, rt = this.target(w, h);
    const prevTarget = r.getRenderTarget(), prevTone = r.toneMapping, prevAlpha = r.getClearAlpha(), prevColor = r.getClearColor(new THREE.Color());
    r.setRenderTarget(rt);
    r.toneMapping = THREE.NoToneMapping;
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(this.scene, this.camera);
    const buf = new Uint8Array(w * h * 4);
    r.readRenderTargetPixels(rt, 0, 0, w, h, buf);
    r.setRenderTarget(prevTarget);
    r.toneMapping = prevTone;
    r.setClearColor(prevColor, prevAlpha);
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      const src = (h - 1 - y) * w * 4, dst = y * w * 4;
      for (let x = 0; x < w * 4; x += 4) {
        const a = buf[src + x + 3]!;
        const k = a > 0 && a < 255 ? 255 / a : 1; // un-premultiply the antialiased edges
        out[dst + x] = Math.min(255, buf[src + x]! * k); out[dst + x + 1] = Math.min(255, buf[src + x + 1]! * k); out[dst + x + 2] = Math.min(255, buf[src + x + 2]! * k); out[dst + x + 3] = a;
      }
    }
    return new ImageData(out, w, h);
  }

  icon(item: ItemId): string {
    const cached = this.icons.get(item);
    if (cached) return cached;
    const size = 128;
    if (this.fig) this.fig.f.object.visible = false;
    const model = buildItem(this.kit, item);
    this.scene.add(model);
    const box = new THREE.Box3().setFromObject(model);
    const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
    model.position.sub(c);
    model.rotation.y = -0.5;
    model.rotation.x = 0.15;
    const r = Math.max(s.x, s.y, s.z, 0.5);
    this.camera.aspect = 1;
    this.camera.position.set(0, 0, r * 3.1);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    const img = this.shoot(size, size);
    this.scene.remove(model);
    if (this.fig) this.fig.f.object.visible = true;
    this.scratch.width = this.scratch.height = size;
    this.scratch.getContext("2d")!.putImageData(img, 0, 0);
    const url = this.scratch.toDataURL("image/png");
    this.icons.set(item, url);
    return url;
  }

  /** Draw the figure into a 2D canvas. Call every frame for a turntable; it throttles itself to about 24 fps. */
  avatar(target: HTMLCanvasElement, hearth: Hearth, look: FigureLook, t: number, key = "preview") {
    const nowMs = performance.now();
    if (nowMs - this.lastAvatar < 40) return;
    this.lastAvatar = nowMs;
    const k = `${key}:${hearth}:${look}`;
    if (!this.fig || this.fig.key !== k) {
      if (this.fig) { this.scene.remove(this.fig.f.object); this.fig.f.dispose(); }
      const info = HEARTH_INFO[hearth];
      const f = new PaperFigure(this.kit, { hearthColor: info.color, accent: info.accent, crest: info.crest, look, skin: skinFor(key) });
      f.setHeld(look === "ranger" ? "bow" : look === "warden" ? "axe" : look === "duelist" ? "spear" : "dagger");
      this.scene.add(f.object);
      this.fig = { key: k, f };
    }
    const f = this.fig.f;
    f.billboard.rotation.y = t * 0.7;
    f.pose({ speed: 0 }, 0.016);
    const w = target.width, hgt = target.height;
    this.camera.aspect = w / hgt;
    this.camera.position.set(0, 2.1, 11.5);
    this.camera.lookAt(0, 1.55, 0);
    this.camera.updateProjectionMatrix();
    target.getContext("2d")!.putImageData(this.shoot(w, hgt), 0, 0);
  }
}

let studio: Studio | null = null;
let studioRenderer: THREE.WebGLRenderer | null = null;
/** Called once by main with the game's renderer. Until then, and if rendering ever fails, 2D fallbacks are used. */
export function attachStudio(renderer: THREE.WebGLRenderer) { studioRenderer = renderer; }
let studioFailed = false;
export function getStudio(): Studio | null {
  if (studio || studioFailed || !studioRenderer) return studio;
  try { studio = new Studio(studioRenderer); } catch { studioFailed = true; reportDiag("studio-failed"); }
  return studio;
}

const fallbackIcons = new Map<string, string>();
/** Flat 2D icon used when the studio is unavailable. */
function fallbackIcon(item: ItemId): string {
  let url = fallbackIcons.get(item);
  if (!url) {
    const c = document.createElement("canvas");
    c.width = c.height = 96;
    const g = c.getContext("2d")!;
    g.fillStyle = ITEM_ACCENT[item];
    g.beginPath(); g.roundRect(14, 14, 68, 68, 14); g.fill();
    g.strokeStyle = "rgba(0,0,0,.35)"; g.lineWidth = 4; g.stroke();
    g.fillStyle = "#fff8e6"; g.font = "700 40px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(itemName(item).slice(0, 1).toUpperCase(), 48, 52);
    url = c.toDataURL("image/png");
    fallbackIcons.set(item, url);
  }
  return url;
}
export const itemIcon = (item: ItemId) => { try { return getStudio()?.icon(item) ?? fallbackIcon(item); } catch { studioFailed = true; return fallbackIcon(item); } };

/** Simple 2D paper doll for the character creator when 3D previews are unavailable. */
export function drawFallbackAvatar(target: HTMLCanvasElement, hearth: Hearth) {
  const g = target.getContext("2d")!, w = target.width, h = target.height, col = HEARTH_INFO[hearth].color;
  g.clearRect(0, 0, w, h);
  g.fillStyle = "#6b5a46"; g.fillRect(w * 0.38, h * 0.62, w * 0.09, h * 0.3); g.fillRect(w * 0.53, h * 0.62, w * 0.09, h * 0.3);
  g.fillStyle = col; g.beginPath(); g.moveTo(w * 0.3, h * 0.3); g.lineTo(w * 0.7, h * 0.3); g.lineTo(w * 0.66, h * 0.64); g.lineTo(w * 0.34, h * 0.64); g.fill();
  g.fillStyle = "#e2b88f"; g.beginPath(); g.arc(w / 2, h * 0.2, w * 0.13, 0, 7); g.fill();
  g.strokeStyle = "rgba(0,0,0,.35)"; g.lineWidth = 3; g.stroke();
}
