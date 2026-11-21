import { svg } from "./dom";

/** Line icons on a 24x24 grid, drawn with currentColor so buttons can tint them. */
const PATHS: Record<string, string> = {
  sword: "M20 4v6l-9 9-2-2-4 4-2-2 4-4-2-2 9-9z",
  shield: "M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z",
  dash: "M5 6l6 6-6 6M13 6l6 6-6 6",
  hand: "M8 12V5.5a1.5 1.5 0 0 1 3 0V11m0-1V4.5a1.5 1.5 0 0 1 3 0V11m0-.5V6.5a1.5 1.5 0 0 1 3 0V15c0 4-2.5 7-6 7-2.5 0-4-1.5-5.5-4L3.5 13.5a1.5 1.5 0 0 1 2.5-1.5L8 14",
  run: "M14 4.5a1.8 1.8 0 1 0 .001 0M9 21l2.5-6-3-3 2.5-5 3.5 3h4M9 12l-4 1",
  mic: "M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3zM18 11a6 6 0 0 1-12 0M12 17v4",
  gear: "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2",
  pack: "M8 7V6a4 4 0 0 1 8 0v1M6 7h12l1 14H5zM9 12h6",
  bubble: "M4 5h16v11H9l-5 4z",
  flare: "M12 2l2.5 6.5L21 9l-5 4.5L17.5 20 12 16.5 6.5 20 8 13.5 3 9l6.5-.5z",
  pact: "M3 12l5-4 4 2 4-2 5 4-5 5-4-2-4 2zM8 8l-1 9M16 8l1 9",
  food: "M7 3v8a2 2 0 0 0 2 2v8M11 3v8a2 2 0 0 1-2 2M17 3c-2 2-3 5-3 8h3v10",
  drop: "M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z",
  bolt: "M13 2L5 14h6l-1 8 8-12h-6z",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 .001 0",
  fullscreen: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
};

export function icon(name: keyof typeof PATHS | string, size = 22): SVGSVGElement {
  const el = svg("svg", { viewBox: "0 0 24 24", width: size, height: size, fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", class: "ico" }) as SVGSVGElement;
  el.append(svg("path", { d: PATHS[name] ?? PATHS.gear! }));
  return el;
}
