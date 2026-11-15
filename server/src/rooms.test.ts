import test from "node:test";
import assert from "node:assert/strict";
import { RoomManager } from "./rooms.js";

test("reconnect preserves the same player and host status", () => {
  let now = 100; const manager = new RoomManager(() => now, () => "CROWN7");
  const { room, player } = manager.create("Aster", "pine", "scout");
  manager.disconnect(room, player.id);
  const joined = manager.join("CROWN7", "Ignored", "salt", "warden", player.reconnectToken);
  assert.equal(joined.player.id, player.id); assert.equal(joined.player.connected, true); assert.equal(joined.player.isHost, true);
  now += 90_001; manager.disconnect(room, player.id); now += 90_001; manager.prune(); assert.equal(manager.rooms.size, 0);
});
test("host migrates when host disconnects", () => {
  const manager = new RoomManager(() => 1, () => "CROWN7"); const { room, player } = manager.create("Aster", "pine", "scout");
  const second = manager.join(room.code, "Rowan", "salt", "warden").player; manager.disconnect(room, player.id);
  assert.equal(second.isHost, true);
});


test("Winnowing starts after the authoritative 15-second countdown", () => {
  let now = 100;
  const manager = new RoomManager(() => now, () => "CROWN7");
  const { room, player: host } = manager.create("Aster", "pine", "scout");
  const players = [host];
  for (let i = 1; i < 5; i++) players.push(manager.join(room.code, "Player" + i, "marsh", "scout").player);
  for (const player of players) manager.update(room, player.id, { type: "set-ready", ready: true });
  manager.update(room, host.id, { type: "start-match" });
  assert.equal(room.phase, "starting");
  assert.equal(room.countdownEndsAt, 15_100);
  now = 15_099;
  assert.equal(manager.advance().length, 0);
  now = 15_100;
  assert.deepEqual(manager.advance(), [room]);
  assert.equal(room.phase, "match");
});
