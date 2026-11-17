import assert from "node:assert/strict";
import test from "node:test";
import type { IncomingMessage } from "node:http";
import { Gate } from "./gate.js";

const req = (cookie?: string) => ({ headers: { cookie }, socket: { remoteAddress: "1.2.3.4" } }) as unknown as IncomingMessage;

test("gate is open when no passphrase is set", () => {
  const g = new Gate("");
  assert.equal(g.required, false);
  assert.equal(g.unlocked(req()), true);
});

test("a wrong passphrase is refused, a right one yields a cookie that unlocks", () => {
  const g = new Gate("moon-pie");
  assert.equal(g.required, true);
  assert.equal(g.unlocked(req()), false);
  assert.ok("error" in g.attempt("ip", "nope"));
  const ok = g.attempt("ip", "moon-pie");
  assert.ok("cookie" in ok);
  const cookie = (ok as { cookie: string }).cookie.split(";")[0]!;
  assert.equal(g.unlocked(req(cookie)), true);
  assert.equal(g.unlocked(req("ac_gate=forged")), false);
});

test("guessing is throttled per address", () => {
  const g = new Gate("moon-pie");
  for (let i = 0; i < 8; i++) g.attempt("a", "x");
  const r = g.attempt("a", "moon-pie");
  assert.ok("error" in r && /Too many/.test(r.error), "even the right passphrase waits out the lockout");
  assert.ok("cookie" in g.attempt("b", "moon-pie"), "other addresses are unaffected");
});
