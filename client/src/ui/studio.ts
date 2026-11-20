import * as THREE from "three";
import type { FigureLook, Hearth, ItemId } from "@ashen-crown/shared";
import { PaperFigure } from "../render/figure";
import { buildItem } from "../render/items";
import { PaperKit } from "../render/paper";
import { HEARTH_INFO, itemName, skinFor } from "../content";
import { ITEM_ACCENT } from "../render/items";
import { reportDiag } from "../diag";

/** One small offscreen renderer that photographs paper models: hotbar icons and character previews. */
class Studio {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(26, 1, 0.1, 100);
  readonly kit = new PaperKit(256);
  private icons = new Map<ItemId, string>();
  private fig: { key: string; f: PaperFigure } | null = null;

  constructor() {
    // Some browsers (Brave with Shields up) refuse extra contexts or flags, so try progressively plainer options.
    let r: THREE.WebGLRenderer | null = null;
    for (const opts of [{ alpha: true, antialias: true, preserveDrawingBuffer: true }, { alpha: true, antialias: false, preserveDrawingBuffer: true }, { alpha: true }]) {
      try { r = new THREE.WebGLRenderer(opts); break; } catch { /* try the next set */ }
    }
    if (!r) throw new Error("no studio context");
    this.renderer = r;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.add(new THREE.HemisphereLight("#fff4e0", "#5a5048", 1.7));
    const key = new THREE.DirectionalLight("#fff0d4", 2.6);
    key.position.set(-3, 5, 6);
    this.scene.add(key);
  }

  icon(item: ItemId): string {
    const cached = this.icons.get(item);
    if (cached) return cached;
    const size = 128;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(size, size);
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
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL("image/png");
    this.scene.remove(model);
    if (this.fig) this.fig.f.object.visible = true;
    this.icons.set(item, url);
    return url;
  }

  /** Draw the figure into a 2D canvas. Call every frame for a turntable effect. */
  avatar(target: HTMLCanvasElement, hearth: Hearth, look: FigureLook, t: number, key = "preview") {
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
    const w = target.width, hgt = target.height;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, hgt);
    f.billboard.rotation.y = Math.sin(t * 0.8) * 0.4;
    f.pose({ speed: 0, facing: 1 }, 0.016);
    this.camera.aspect = w / hgt;
    this.camera.position.set(0, 1.55, 11.5);
    this.camera.lookAt(0, 1.45, 0);
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
    const ctx = target.getContext("2d")!;
    ctx.clearRect(0, 0, w, hgt);
    ctx.drawImage(this.renderer.domElement, 0, 0, w, hgt);
  }
}

let studio: Studio | null = null;
let studioFailed = false;
/** The studio is optional decoration. If the browser won't give a second WebGL context we never ask again. */
export function getStudio(): Studio | null {
  if (studio || studioFailed) return studio;
  try { studio = new Studio(); } catch { studioFailed = true; reportDiag("studio-failed"); }
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
export const itemIcon = (item: ItemId) => getStudio()?.icon(item) ?? fallbackIcon(item);

/** Simple 2D paper doll for the character creator when 3D previews are unavailable. */
export function drawFallbackAvatar(target: HTMLCanvasElement, hearth: Hearth) {
  const g = target.getContext("2d")!, w = target.width, h = target.height, col = HEARTH_INFO[hearth].color;
  g.clearRect(0, 0, w, h);
  g.fillStyle = "#6b5a46"; g.fillRect(w * 0.38, h * 0.62, w * 0.09, h * 0.3); g.fillRect(w * 0.53, h * 0.62, w * 0.09, h * 0.3);
  g.fillStyle = col; g.beginPath(); g.moveTo(w * 0.3, h * 0.3); g.lineTo(w * 0.7, h * 0.3); g.lineTo(w * 0.66, h * 0.64); g.lineTo(w * 0.34, h * 0.64); g.fill();
  g.fillStyle = "#e2b88f"; g.beginPath(); g.arc(w / 2, h * 0.2, w * 0.13, 0, 7); g.fill();
  g.strokeStyle = "rgba(0,0,0,.35)"; g.lineWidth = 3; g.stroke();
}
