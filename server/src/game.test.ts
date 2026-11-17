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

function twoPlayers() {
  const rooms = new RoomManager(() => 1, () => "CROWN7");
  const { room, player } = rooms.create("Aster", "pine", "scout");
  const other = rooms.join("CROWN7", "Bryn", "salt", "ranger");
  const engine = new GameEngine();
  engine.start(room, 1);
  const state = engine.get(room.code)!;
  const a = state.players.find(p => p.id === player.id)!;
  const b = state.players.find(p => p.id === other.player.id)!;
  return { room, engine, state, a, b };
}

test("looting is a two second channel that damage interrupts", () => {
  const { room, engine, state, a } = twoPlayers();
  state.loot = [{ id: "d1", item: "ration", count: 1, x: a.x, z: a.z }];
  engine.action(room.code, a.id, { type: "loot", dropId: "d1" }, 1000);
  assert.equal(a.looting?.dropId, "d1");
  engine.tick(room, 1500);
  assert.equal(a.inventory.some(x => x.item === "ration"), false, "not granted before 2s");
  engine.tick(room, 3100);
  assert.equal(a.inventory.some(x => x.item === "ration"), true, "granted after 2s");
  assert.equal(a.looting, null);

  state.loot = [{ id: "d2", item: "bandage", count: 1, x: a.x, z: a.z }];
  engine.action(room.code, a.id, { type: "loot", dropId: "d2" }, 5000);
  a.health -= 10;
  engine.tick(room, 7500);
  assert.equal(a.inventory.some(x => x.item === "bandage"), false, "damage cancels the channel");
  assert.equal(state.loot.length, 1);
});

test("inventory swap reorders stacks but never moves the dagger", () => {
  const { room, engine, a } = twoPlayers();
  a.inventory = [{ item: "dagger", count: 1 }, { item: "ration", count: 2 }, { item: "bandage", count: 1 }];
  engine.action(room.code, a.id, { type: "swap", a: 1, b: 2 }, 1000);
  assert.deepEqual(a.inventory.map(s => s.item), ["dagger", "bandage", "ration"]);
  engine.action(room.code, a.id, { type: "swap", a: 0, b: 1 }, 2000);
  assert.equal(a.inventory[0]!.item, "dagger");
  engine.action(room.code, a.id, { type: "swap", a: 1, b: 7 }, 3000);
  assert.deepEqual(a.inventory.map(s => s.item), ["dagger", "ration", "bandage"]);
});

test("collapsed zones hurt more the longer you stay, and Base Camp stays safe", () => {
  const { room, engine, state, a } = twoPlayers();
  state.zone.collapsed = [2];
  state.zone.collapsedAt = [0];
  a.x = Math.cos(2 * Math.PI / 3) * 25; a.z = Math.sin(2 * Math.PI / 3) * 25;
  const h0 = a.health;
  engine.tick(room, 2_000);
  const early = h0 - a.health;
  a.health = 100;
  engine.tick(room, 40_000);
  const late = 100 - a.health;
  assert.ok(early > 0 && late > early, `escalates: ${early} then ${late}`);
  a.health = 100; a.x = 7.1; a.z = 0;
  engine.tick(room, 41_000);
  assert.ok(a.health > 99.9, "Base Camp ring is not a hazard");
});

test("the collapse order is seeded from the room code and never repeats a zone", () => {
  const run = () => {
    const { room, engine, state } = twoPlayers();
    const seen: number[] = [];
    let now = 1;
    for (let i = 0; i < 5; i++) {
      state.zone.nextCollapseAt = now;
      engine.tick(room, now);
      seen.push(state.zone.warningZone!);
      now = state.zone.collapseAt! + 1;
      engine.tick(room, now);
    }
    return seen;
  };
  const first = run();
  assert.deepEqual(run(), first, "same code, same order");
  assert.equal(new Set(first).size, 5);
});

test("the feed keeps Herald lines and emotes as separate entries", () => {
  const { room, engine, state, a } = twoPlayers();
  engine.action(room.code, a.id, { type: "emote", text: "Danger" }, 1000);
  engine.action(room.code, a.id, { type: "emote", text: "Danger" }, 2000);
  const emotes = state.feed!.filter(f => f.kind === "emote");
  assert.equal(emotes.length, 2, "repeated identical emotes are both recorded");
  assert.equal(emotes[0]!.actorId, a.id);
});

test("lobby players can change their look until the match starts", () => {
  const rooms = new RoomManager(() => 1, () => "CROWN7");
  const { room, player } = rooms.create("Aster", "pine", "scout");
  rooms.update(room, player.id, { type: "set-profile", name: "  Asta  ", hearth: "frost", look: "warden" });
  assert.deepEqual([player.name, player.hearth, player.look], ["Asta", "frost", "warden"]);
  assert.throws(() => rooms.update(room, player.id, { type: "set-profile", name: "", hearth: "frost", look: "warden" }));
});
