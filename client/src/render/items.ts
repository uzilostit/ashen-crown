import * as THREE from "three";
import type { ItemId } from "@ashen-crown/shared";
import type { PaperKit } from "./paper";

type Pt = [number, number];
const matCache = new WeakMap<PaperKit, Map<string, THREE.Material>>();
function m(kit: PaperKit, color: string, o: Parameters<PaperKit["mat"]>[1] = {}) {
  let c = matCache.get(kit);
  if (!c) matCache.set(kit, (c = new Map()));
  const key = color + JSON.stringify(o);
  let v = c.get(key);
  if (!v) c.set(key, (v = kit.mat(color, { repeat: 0.9, normalScale: 0.5, ...o })));
  return v;
}

/** A flat cut-paper card extruded to a few millimetres of thickness. */
export function card(kit: PaperKit, pts: Pt[], color: string, depth = 0.07, edge = "#f1e8d3") {
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 1, curveSegments: 4 });
  g.translate(0, 0, -depth / 2);
  const mesh = new THREE.Mesh(g, [m(kit, color), m(kit, edge)]);
  mesh.castShadow = true;
  return mesh;
}
const box = (kit: PaperKit, w: number, h: number, d: number, color: string, o = {}) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m(kit, color, o));
  mesh.castShadow = true;
  return mesh;
};
const cyl = (kit: PaperKit, r: number, h: number, color: string, seg = 10, o = {}) => {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m(kit, color, o));
  mesh.castShadow = true;
  return mesh;
};
const at = <T extends THREE.Object3D>(o: T, x: number, y: number, z = 0, rz = 0) => {
  o.position.set(x, y, z);
  o.rotation.z = rz;
  return o;
};

const STEEL = "#cfd6da", WOOD = "#8a6a46", DARK = "#4a3a2c", RED = "#c6463d", CREAM = "#efe6cf";

export function buildItem(kit: PaperKit, id: ItemId): THREE.Group {
  const g = new THREE.Group();
  switch (id) {
    case "dagger":
      g.add(card(kit, [[-0.08, 0], [0.08, 0], [0.08, 0.6], [0, 0.84], [-0.08, 0.6]], STEEL, 0.05, "#f5f7f8"), at(box(kit, 0.36, 0.07, 0.1, "#b88a3c", { metalness: 0.5 }), 0, -0.02), at(cyl(kit, 0.05, 0.28, DARK), 0, -0.17), at(new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), m(kit, "#b88a3c", { metalness: 0.5 })), 0, -0.34));
      g.position.y = 0.28;
      break;
    case "spear":
      g.add(cyl(kit, 0.035, 2, WOOD, 6), at(card(kit, [[-0.12, 0], [0.12, 0], [0, 0.55]], STEEL, 0.05, "#f5f7f8"), 0, 1.0), at(box(kit, 0.1, 0.06, 0.1, RED), 0, 0.98));
      break;
    case "bow": {
      const outer: Pt[] = [], inner: Pt[] = [];
      for (let i = 0; i <= 10; i++) {
        const t = i / 10, y = (t - 0.5) * 1.5, x = -Math.sin(Math.PI * t) * 0.34;
        outer.push([x, y]);
        inner.unshift([x + 0.06, y]);
      }
      g.add(card(kit, [...outer, ...inner], "#7c5b3a", 0.06), at(box(kit, 0.012, 1.5, 0.012, CREAM), 0, 0, 0));
      break;
    }
    case "arrows":
      for (let i = 0; i < 3; i++) {
        const a = new THREE.Group();
        a.add(cyl(kit, 0.018, 0.9, WOOD, 5), at(new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 4), m(kit, STEEL)), 0, 0.5), at(card(kit, [[-0.07, 0], [0.07, 0], [0.04, 0.2], [-0.04, 0.2]], RED, 0.02), 0, -0.4));
        a.position.set((i - 1) * 0.14, 0, (i % 2) * 0.05);
        a.rotation.z = (i - 1) * 0.1;
        g.add(a);
      }
      break;
    case "axe":
      g.add(cyl(kit, 0.04, 1.2, WOOD, 6), at(card(kit, [[0, 0.5], [0.38, 0.7], [0.46, 0.3], [0, 0.2]], STEEL, 0.06, "#f5f7f8"), 0.03, 0.2), at(box(kit, 0.1, 0.14, 0.1, DARK), 0, 0.5));
      g.position.y = -0.1;
      break;
    case "crossbow":
      g.add(box(kit, 0.12, 0.8, 0.07, WOOD), at(box(kit, 0.85, 0.07, 0.06, DARK), 0, 0.28), at(box(kit, 0.1, 0.18, 0.09, DARK), 0, -0.45), at(card(kit, [[-0.42, 0.28], [0, 0.46], [0.42, 0.28], [0, 0.36]], "#6d5338", 0.05), 0, 0));
      break;
    case "bandage":
      g.add(cyl(kit, 0.17, 0.22, "#f4efe2", 14), at(cyl(kit, 0.175, 0.06, RED, 14), 0, 0));
      g.position.y = 0.11;
      break;
    case "splint":
      g.add(at(box(kit, 0.1, 0.8, 0.04, "#b99a63"), -0.09, 0), at(box(kit, 0.1, 0.8, 0.04, "#b99a63"), 0.09, 0), at(box(kit, 0.34, 0.07, 0.07, CREAM), 0, 0.2), at(box(kit, 0.34, 0.07, 0.07, CREAM), 0, -0.2));
      g.rotation.z = 0.3;
      break;
    case "healthKit":
      g.add(box(kit, 0.58, 0.42, 0.22, RED), at(box(kit, 0.34, 0.08, 0.02, "#fbf6ea"), 0, 0, 0.115), at(box(kit, 0.08, 0.3, 0.02, "#fbf6ea"), 0, 0, 0.115), at(box(kit, 0.2, 0.05, 0.1, "#b88a3c", { metalness: 0.5 }), 0, 0.22));
      g.position.y = 0.21;
      break;
    case "waterBottle":
      g.add(cyl(kit, 0.17, 0.5, "#4f9ac6", 12, { roughness: 0.5 }), at(cyl(kit, 0.1, 0.1, "#2c4a5c", 10), 0, 0.3), at(cyl(kit, 0.175, 0.16, CREAM, 12), 0, 0));
      g.position.y = 0.25;
      break;
    case "ration":
      g.add(box(kit, 0.52, 0.3, 0.3, "#c8a05c"), at(box(kit, 0.1, 0.32, 0.32, "#8a6b3a"), 0, 0), at(box(kit, 0.5, 0.04, 0.32, "#8a6b3a"), 0, 0.01));
      g.position.y = 0.15;
      break;
    case "backpack":
      g.add(box(kit, 0.6, 0.72, 0.32, "#7b5b3c"), at(box(kit, 0.62, 0.26, 0.34, "#5e4329"), 0, 0.3), at(box(kit, 0.16, 0.2, 0.06, "#7b5b3c"), 0, -0.2, 0.18), at(box(kit, 0.1, 0.09, 0.04, "#c9a24a", { metalness: 0.8 }), 0, 0.18, 0.19));
      g.position.y = 0.36;
      break;
    case "flareGun":
      g.add(box(kit, 0.62, 0.15, 0.12, "#e0472b"), at(box(kit, 0.15, 0.36, 0.11, DARK), -0.2, -0.2, 0, 0.25), at(cyl(kit, 0.09, 0.05, "#c9a24a", 10, { metalness: 0.8 }), 0.32, 0, 0, Math.PI / 2));
      g.position.y = 0.2;
      break;
    case "torch": {
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.42, 5), new THREE.MeshStandardMaterial({ color: "#ffb347", emissive: "#ff7a1a", emissiveIntensity: 1.6 }));
      flame.name = "flame";
      g.add(cyl(kit, 0.045, 1, WOOD, 6), at(cyl(kit, 0.1, 0.18, DARK, 8), 0, 0.5), at(flame, 0, 0.82));
      break;
    }
    case "snare": {
      const loop = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.03, 5, 18), m(kit, "#a34f39"));
      loop.rotation.x = Math.PI / 2;
      g.add(loop, at(cyl(kit, 0.03, 0.5, WOOD, 5), 0.3, 0.2), at(card(kit, [[0, 0], [0.22, 0.06], [0, 0.14]], RED, 0.02), 0.3, 0.42));
      g.position.y = 0.04;
      break;
    }
  }
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
  return g;
}

export const ITEM_ACCENT: Record<ItemId, string> = {
  dagger: "#cfd6da", spear: "#8a6a46", bow: "#7c5b3a", arrows: "#c6463d", axe: "#cfd6da", crossbow: "#6d5338", bandage: "#f4efe2",
  splint: "#b99a63", healthKit: "#c6463d", waterBottle: "#4f9ac6", ration: "#c8a05c", backpack: "#7b5b3c", flareGun: "#e0472b", torch: "#ff9a3d", snare: "#a34f39",
};

export type Weapon = "dagger" | "spear" | "axe" | "bow" | "crossbow";
/** The weapon a player would actually fight with, matching the server's damage rules. */
export function bestWeapon(inv: { item: ItemId; count: number }[]): Weapon {
  const has = (i: ItemId) => inv.some((s) => s.item === i);
  const ammo = inv.some((s) => s.item === "arrows" && s.count > 0);
  if (has("crossbow") && ammo) return "crossbow";
  if (has("bow") && ammo) return "bow";
  if (has("axe")) return "axe";
  if (has("spear")) return "spear";
  return "dagger";
}
