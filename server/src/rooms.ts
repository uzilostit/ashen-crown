import { randomUUID } from "node:crypto";
import { MAX_ROOM_PLAYERS, MIN_MATCH_PLAYERS, defaultSettings, makeRoomCode, normalizeName, type ClientMessage, type FigureLook, type Hearth, type PlayerView, type RoomSettings, type RoomView } from "@ashen-crown/shared";

export interface Player extends PlayerView { reconnectToken: string; disconnectedAt?: number; }
export interface Room { code: string; phase: RoomView["phase"]; countdownEndsAt?: number; players: Map<string, Player>; settings: RoomSettings; }
export class RoomError extends Error {}
export class RoomManager {
  readonly rooms = new Map<string, Room>();
  constructor(private now = () => Date.now(), private code = () => makeRoomCode()) {}
  create(name: string, hearth: Hearth, look: FigureLook): { room: Room; player: Player } {
    let code = this.code(); while (this.rooms.has(code)) code = this.code();
    const player = this.newPlayer(name, hearth, look, true);
    const room: Room = { code, phase: "lobby", players: new Map([[player.id, player]]), settings: defaultSettings() };
    this.rooms.set(code, room); return { room, player };
  }
  join(code: string, name: string, hearth: Hearth, look: FigureLook, token?: string): { room: Room; player: Player; reconnected: boolean } {
    const room = this.requireRoom(code);
    if (room.phase !== "lobby") throw new RoomError("The Winnowing has already begun.");
    const existing = token ? [...room.players.values()].find(p => p.reconnectToken === token) : undefined;
    if (existing) { existing.connected = true; existing.disconnectedAt = undefined; if (![...room.players.values()].some(p => p.isHost && p.connected)) existing.isHost = true; return { room, player: existing, reconnected: true }; }
    if (room.players.size >= MAX_ROOM_PLAYERS) throw new RoomError("This room is full.");
    const player = this.newPlayer(name, hearth, look, false); room.players.set(player.id, player); return { room, player, reconnected: false };
  }
  disconnect(room: Room, playerId: string): void { const player = room.players.get(playerId); if (!player) return; player.connected = false; player.ready = false; player.disconnectedAt = this.now(); this.migrateHost(room); }
  prune(): void { for (const room of this.rooms.values()) { for (const player of room.players.values()) if (!player.connected && player.disconnectedAt && this.now() - player.disconnectedAt > 90_000) room.players.delete(player.id); this.migrateHost(room); if (room.players.size === 0) this.rooms.delete(room.code); } }
  update(room: Room, playerId: string, message: ClientMessage): void {
    const player = this.requirePlayer(room, playerId);
    if (message.type === "set-ready") { this.requireLobby(room); player.ready = message.ready; return; }
    if (message.type === "set-settings") { this.requireHost(player); this.requireLobby(room); room.settings = this.validateSettings(message.settings); return; }
    if (message.type === "kick-player") { this.requireHost(player); const target = room.players.get(message.playerId); if (!target || target.isHost) throw new RoomError("That player cannot be removed."); room.players.delete(target.id); return; }
    if (message.type === "start-match") { this.requireHost(player); this.requireLobby(room); const ready = [...room.players.values()].filter(p => p.connected && p.ready); if (ready.length < MIN_MATCH_PLAYERS) throw new RoomError("Five connected and ready players are required."); room.phase = "starting"; room.countdownEndsAt = this.now() + 15_000; return; }
    if (message.type === "play-again") { this.requireHost(player); if (room.phase !== "ended") throw new RoomError("The match has not ended."); room.phase = "lobby"; room.countdownEndsAt = undefined; for (const p of room.players.values()) p.ready = false; }
  }
  advance(): Room[] { const changed: Room[] = []; for (const room of this.rooms.values()) { if (room.phase === "starting" && room.countdownEndsAt !== undefined && this.now() >= room.countdownEndsAt) { room.phase = "match"; changed.push(room); } } return changed; }
  view(room: Room): RoomView { return { code: room.code, phase: room.phase, countdownEndsAt: room.countdownEndsAt ?? null, players: [...room.players.values()].map(({ reconnectToken, disconnectedAt, ...view }) => view), settings: room.settings, maxPlayers: MAX_ROOM_PLAYERS, minPlayers: MIN_MATCH_PLAYERS }; }
  private newPlayer(name: string, hearth: Hearth, look: FigureLook, isHost: boolean): Player { const normalized = normalizeName(name); if (!normalized) throw new RoomError("Choose a name to enter the Winnowing."); return { id: randomUUID(), reconnectToken: randomUUID(), name: normalized, hearth, look, ready: false, connected: true, isHost }; }
  private requireRoom(code: string): Room { const room = this.rooms.get(code.toUpperCase()); if (!room) throw new RoomError("No room exists with that code."); return room; }
  private requirePlayer(room: Room, id: string): Player { const p = room.players.get(id); if (!p) throw new RoomError("Player no longer belongs to this room."); return p; }
  private requireHost(player: Player) { if (!player.isHost) throw new RoomError("Only the host can do that."); }
  private requireLobby(room: Room) { if (room.phase !== "lobby") throw new RoomError("Lobby controls are closed."); }
  private migrateHost(room: Room) { const host = [...room.players.values()].find(p => p.isHost && p.connected); if (host) return; for (const p of room.players.values()) p.isHost = false; const successor = [...room.players.values()].find(p => p.connected); if (successor) successor.isHost = true; }
  private validateSettings(settings: RoomSettings): RoomSettings { if (![20, 30, 45].includes(settings.matchLengthMinutes) || !["slow", "standard", "fast"].includes(settings.collapseSpeed) || typeof settings.friendlyFire !== "boolean") throw new RoomError("Invalid room settings."); return settings; }
}

