import * as THREE from "three";
import type { FigureLook, Hearth, ItemId } from "@ashen-crown/shared";
import { PaperFigure } from "../render/figure";
import { buildItem } from "../render/items";
import { PaperKit } from "../render/paper";
import { HEARTH_INFO, skinFor } from "../content";

/** One small offscreen renderer that photographs paper models: hotbar icons and character previews. */
class Studio {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(26, 1, 0.1, 100);
  readonly kit = new PaperKit(256);
  private icons = new Map<ItemId, string>();
  private fig: { key: string; f: PaperFigure } | null = null;

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
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
export const getStudio = () => (studio ??= new Studio());
export const itemIcon = (item: ItemId) => getStudio().icon(item);
