import test from "node:test";
import assert from "node:assert/strict";
import { RoomManager } from "./rooms.js";
import { GameEngine } from "./game.js";

test("server simulation moves players from validated inputs", () => {
  const rooms = new RoomManager(() => 1, () => "CROWN7");
  const { room, player } = rooms.create("Aster", "pine", "scout");
  const engine = new GameEngine();
  engine.start(room, 1);
  const before = engine.get(room.code)!.players.find(p => p.id === player.id)!.x;
  engine.input(room.code, player.id, { x: 1, z: 0, yaw: 0, sprint: false });
  engine.tick(room, 51);
  const after = engine.get(room.code)!.players.find(p => p.id === player.id)!.x;
  assert.ok(after > before);
});

test("melee attack is server validated and damages nearby opponents", () => {
  const rooms = new RoomManager(() => 1, () => "CROWN7");
  const { room, player: first } = rooms.create("Aster", "pine", "scout");
  const second = rooms.join(room.code, "Rowan", "salt", "warden").player;
  const engine = new GameEngine();
  engine.start(room, 1);
  const state = engine.get(room.code)!;
  const a = state.players.find(p => p.id === first.id)!;
  const b = state.players.find(p => p.id === second.id)!;
  b.x = a.x + 1;
  b.z = a.z;
  engine.action(room.code, first.id, { type: "attack", targetId: second.id }, 500);
  assert.equal(b.health, 78);
});

test("survival needs drain and the safe boundary inflicts damage", () => {
  const rooms = new RoomManager(() => 1, () => "CROWN7");
  const { room, player } = rooms.create("Aster", "pine", "scout");
  const engine = new GameEngine();
  engine.start(room, 1);
  const p = engine.get(room.code)!.players.find(x => x.id === player.id)!;
  p.x = 42; p.z = 0;
  const health = p.health;
  engine.tick(room, 51);
  assert.ok(p.health < health);
  assert.ok(p.hunger < 100 && p.thirst < 100);
});
