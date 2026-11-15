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
  engine.input(room.code, player.id, { x: 1, z: 0, yaw: 0, sprint: false, block: false, dodge: false });
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

test("alliance invites are visible and accepted by the target", () => {
  const rooms = new RoomManager(() => 1, () => "CROWN7");
  const { room, player: first } = rooms.create("Aster", "pine", "scout");
  const second = rooms.join(room.code, "Rowan", "salt", "warden").player;
  const engine = new GameEngine();
  engine.start(room, 1);
  const state = engine.get(room.code)!;
  const a = state.players.find(p => p.id === first.id)!;
  const b = state.players.find(p => p.id === second.id)!;
  b.x = a.x + 1; b.z = a.z;
  engine.action(room.code, first.id, { type: "ally-invite", targetId: second.id }, 500);
  assert.equal(engine.snapshot(room.code)!.allianceInvites[0].toId, second.id);
  engine.action(room.code, second.id, { type: "ally-respond", fromId: first.id, accept: true }, 800);
  assert.ok(a.allianceId && a.allianceId === b.allianceId);
  assert.equal(engine.snapshot(room.code)!.allianceInvites.length, 0);
});

test("snare traps injure opponents and splints repair broken legs", () => {
  const rooms = new RoomManager(() => 1, () => "CROWN7");
  const { room, player: first } = rooms.create("Aster", "pine", "scout");
  const second = rooms.join(room.code, "Rowan", "salt", "warden").player;
  const engine = new GameEngine();
  engine.start(room, 1);
  const state = engine.get(room.code)!;
  const a = state.players.find(p => p.id === first.id)!;
  const b = state.players.find(p => p.id === second.id)!;
  a.inventory.push({ item: "snare", count: 1 });
  b.x = a.x + 0.5; b.z = a.z;
  engine.action(room.code, first.id, { type: "use", slot: 1 }, 500);
  assert.equal(state.traps.length, 1);
  engine.tick(room, 551);
  assert.equal(b.brokenLeg, true);
  assert.ok(b.health < 100);
  b.inventory.push({ item: "splint", count: 1 });
  engine.action(room.code, second.id, { type: "use", slot: 1 }, 900);
  assert.equal(b.brokenLeg, false);
});

test("eliminated players can spend patron points on a parachute gift", () => {
  const rooms = new RoomManager(() => 1, () => "CROWN7");
  const { room, player: first } = rooms.create("Aster", "pine", "scout");
  const second = rooms.join(room.code, "Rowan", "salt", "warden").player;
  const engine = new GameEngine();
  engine.start(room, 1);
  const state = engine.get(room.code)!;
  const living = state.players.find(p => p.id === first.id)!;
  const spectator = state.players.find(p => p.id === second.id)!;
  spectator.alive = false;
  spectator.patronPoints = 1;
  engine.action(room.code, second.id, { type: "spectator-gift", targetId: first.id, item: "ration" }, 500);
  assert.equal(spectator.patronPoints, 0);
  assert.ok(living.inventory.some(x => x.item === "ration"));
});

test("blocking reduces damage and a timed dodge avoids an attack", () => {
  const rooms = new RoomManager(() => 1, () => "CROWN7");
  const { room, player: first } = rooms.create("Aster", "pine", "scout");
  const second = rooms.join(room.code, "Rowan", "salt", "warden").player;
  const engine = new GameEngine();
  engine.start(room, 1);
  const state = engine.get(room.code)!;
  const a = state.players.find(p => p.id === first.id)!;
  const b = state.players.find(p => p.id === second.id)!;
  b.x = a.x + 1; b.z = a.z;
  engine.input(room.code, second.id, { x: 0, z: 0, yaw: 0, sprint: false, block: true, dodge: false }, 1000);
  engine.action(room.code, first.id, { type: "attack", targetId: second.id }, 1100);
  assert.equal(b.health, 92);
  engine.input(room.code, second.id, { x: 0, z: 0, yaw: 0, sprint: false, block: false, dodge: true }, 2100);
  engine.action(room.code, first.id, { type: "attack", targetId: second.id }, 2200);
  assert.equal(b.health, 92);
});

test("flare escape only unlocks after the five zone collapses", () => {
  const rooms = new RoomManager(() => 1, () => "CROWN7");
  const { room, player } = rooms.create("Aster", "pine", "scout");
  const engine = new GameEngine();
  engine.start(room, 1);
  const state = engine.get(room.code)!;
  const p = state.players.find(x => x.id === player.id)!;
  p.inventory.push({ item: "flareGun", count: 1 });
  engine.action(room.code, player.id, { type: "flare" }, 500);
  assert.equal(state.phase, "playing");
  state.zone.collapsed = [0,1,2,3,4];
  engine.action(room.code, player.id, { type: "flare" }, 800);
  assert.equal(state.phase, "flare");
});
