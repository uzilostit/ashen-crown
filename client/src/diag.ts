/** Tiny, anonymous diagnostics so rendering problems can be seen from the server logs: GPU, tier, frame times, errors. */
type Info = Record<string, unknown>;
let base: Info = {};
let sent = 0;

export function reportDiag(kind: string, extra: Info = {}) {
  if (sent++ > 40) return;
  try {
    const body = JSON.stringify({ kind, ...base, ...extra, t: Math.round(performance.now() / 1000) });
    if (!navigator.sendBeacon?.("/api/diag", new Blob([body], { type: "application/json" }))) void fetch("/api/diag", { method: "POST", body, keepalive: true, headers: { "content-type": "application/json" } });
  } catch { /* diagnostics must never break the game */ }
}

export function initDiag(gl: WebGLRenderingContext | WebGL2RenderingContext, tier: number, profile: string, auto: boolean) {
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  base = {
    ua: navigator.userAgent.slice(0, 160),
    screen: `${innerWidth}x${innerHeight}@${devicePixelRatio}`,
    touch: `${navigator.maxTouchPoints}/${matchMedia("(pointer:coarse)").matches ? "coarse" : "fine"}`,
    gpu: dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)).slice(0, 80) : "unknown",
    gl: String(gl.getParameter(gl.VERSION)).slice(0, 40),
    cores: navigator.hardwareConcurrency,
    tier, profile, auto,
  };
  reportDiag("boot");
  addEventListener("error", (e) => reportDiag("error", { msg: String(e.message).slice(0, 200) }));
  addEventListener("unhandledrejection", (e) => reportDiag("rejection", { msg: String((e.reason as Error)?.message ?? e.reason).slice(0, 200) }));
}
export const updateDiag = (patch: Info) => { base = { ...base, ...patch }; };
