import type { Crest } from "../content";
import { crestPoints } from "../render/figure";
import { svg } from "./dom";

/** Hearth crest as an inline SVG, drawn from the same shapes as the 3D figure's chest badge. */
export function crestSvg(crest: Crest, fill = "#f3ead4"): SVGSVGElement {
  const pts = crestPoints(crest).map(([x, y]) => `${(x * 0.82 + 0.5) * 24},${(0.5 - y * 0.82) * 24}`).join(" ");
  const el = svg("svg", { viewBox: "0 0 24 24", class: "crest", "aria-hidden": "true" }, svg("polygon", { points: pts, fill, stroke: "rgba(0,0,0,.35)", "stroke-width": 0.6, "stroke-linejoin": "round" })) as SVGSVGElement;
  return el;
}
