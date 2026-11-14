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

