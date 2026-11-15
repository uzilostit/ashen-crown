import * as THREE from "three";
import { mulberry32 } from "./util";

/** Draws thousands of hair-thin fibre strokes into a height map, then derives a tileable normal map. */
function fibreNormalCanvas(size: number): HTMLCanvasElement {
  const rnd = mulberry32(90210);
  const h = document.createElement("canvas");
  h.width = h.height = size;
  const g = h.getContext("2d")!;
  g.fillStyle = "#808080";
  g.fillRect(0, 0, size, size);
  g.lineCap = "round";
  const strokes = Math.floor((size * size) / 70);
  for (let i = 0; i < strokes; i++) {
    const x = rnd() * size, y = rnd() * size, a = rnd() * Math.PI, len = 5 + rnd() * 20;
    const dx = Math.cos(a) * len, dy = Math.sin(a) * len;
    g.strokeStyle = rnd() > 0.5 ? "#ffffff" : "#000000";
    g.globalAlpha = 0.05 + rnd() * 0.1;
    g.lineWidth = 0.5 + rnd() * 0.9;
    for (const ox of x < len || x > size - len ? [-size, 0, size] : [0])
      for (const oy of y < len || y > size - len ? [-size, 0, size] : [0]) {
        g.beginPath();
        g.moveTo(x + ox, y + oy);
        g.lineTo(x + ox + dx, y + oy + dy);
        g.stroke();
      }
  }
  // soft mottling, like uneven pulp
  g.globalAlpha = 0.05;
  for (let i = 0; i < size / 4; i++) {
    g.fillStyle = rnd() > 0.5 ? "#fff" : "#000";
    g.beginPath();
    g.arc(rnd() * size, rnd() * size, 6 + rnd() * 26, 0, Math.PI * 2);
    g.fill();
  }
  const src = g.getImageData(0, 0, size, size).data;
  const out = document.createElement("canvas");
  out.width = out.height = size;
  const og = out.getContext("2d")!;
  const dst = og.createImageData(size, size);
  const at = (x: number, y: number) => src[(((y + size) % size) * size + ((x + size) % size)) * 4]! / 255;
  const strength = 2.6;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
      const dy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
      const nx = -dx * strength, ny = -dy * strength, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 4;
      dst.data[i] = (nx / l * 0.5 + 0.5) * 255;
      dst.data[i + 1] = (ny / l * 0.5 + 0.5) * 255;
      dst.data[i + 2] = (nz / l * 0.5 + 0.5) * 255;
      dst.data[i + 3] = 255;
    }
  og.putImageData(dst, 0, 0);
  return out;
}

export interface PaperOpts {
  /** Texture tiles per world unit. */
  repeat?: number;
  normalScale?: number;
  flat?: boolean;
  vertexColors?: boolean;
  side?: THREE.Side;
  roughness?: number;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  metalness?: number;
}

/** Shared paper-fibre texture plus a factory for consistent paper and card materials. */
export class PaperKit {
  private base: THREE.CanvasTexture;
  private textures = new Map<number, THREE.Texture>();
  private owned: THREE.Material[] = [];

  constructor(textureSize = 512) {
    this.base = new THREE.CanvasTexture(fibreNormalCanvas(textureSize));
    this.base.wrapS = this.base.wrapT = THREE.RepeatWrapping;
    this.base.colorSpace = THREE.NoColorSpace;
    this.base.anisotropy = 4;
  }

  private tex(repeat: number) {
    let t = this.textures.get(repeat);
    if (!t) {
      t = this.base.clone();
      t.repeat.set(repeat, repeat);
      t.needsUpdate = true;
      this.textures.set(repeat, t);
    }
    return t;
  }

  mat(color: THREE.ColorRepresentation, o: PaperOpts = {}): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({
      color,
      roughness: o.roughness ?? 0.94,
      metalness: o.metalness ?? 0,
      normalMap: this.tex(o.repeat ?? 0.22),
      normalScale: new THREE.Vector2(o.normalScale ?? 0.7, o.normalScale ?? 0.7),
      flatShading: o.flat ?? false,
      vertexColors: o.vertexColors ?? false,
      side: o.side ?? THREE.FrontSide,
      emissive: o.emissive ?? 0x000000,
      emissiveIntensity: o.emissiveIntensity ?? 1,
      transparent: o.transparent ?? false,
      opacity: o.opacity ?? 1,
    });
    this.owned.push(m);
    return m;
  }

  /** Brass paper-fastener (brad) material. */
  brass() {
    const m = new THREE.MeshStandardMaterial({ color: "#c9a24a", roughness: 0.34, metalness: 0.85 });
    this.owned.push(m);
    return m;
  }

  dispose() {
    this.owned.forEach((m) => m.dispose());
    this.textures.forEach((t) => t.dispose());
    this.base.dispose();
  }
}

/** Soft translucent card texture used for fog sheets and light shafts. */
export function cloudTexture(size = 128, seed = 3): THREE.CanvasTexture {
  const rnd = mulberry32(seed);
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, size, size);
  for (let i = 0; i < 46; i++) {
    const x = size * (0.2 + rnd() * 0.6), y = size * (0.2 + rnd() * 0.6), r = size * (0.08 + rnd() * 0.2);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, "rgba(255,255,255,0.28)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
