export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const MAX_ROOM_PLAYERS = 15;
export const MIN_MATCH_PLAYERS = 5;

export type Hearth = "marsh" | "cinder" | "pine" | "salt" | "frost" | "orchard";
export const HEARTHS: Hearth[] = ["marsh", "cinder", "pine", "salt", "frost", "orchard"];
export type FigureLook = "scout" | "warden" | "ranger" | "duelist";

export interface RoomSettings {
  matchLengthMinutes: number;
  collapseSpeed: "slow" | "standard" | "fast";
  friendlyFire: boolean;
}
export interface PlayerView {
  id: string;
  name: string;
  hearth: Hearth;
  look: FigureLook;
  ready: boolean;
  connected: boolean;
  isHost: boolean;
}
export interface RoomView {
  code: string;
  phase: "lobby" | "starting" | "match" | "ended";
  countdownEndsAt: number | null;
  players: PlayerView[];
  settings: RoomSettings;
  maxPlayers: number;
  minPlayers: number;
}
export type ClientMessage =
  | { type: "create-room"; name: string; hearth: Hearth; look: FigureLook }
  | { type: "join-room"; code: string; name: string; hearth: Hearth; look: FigureLook; reconnectToken?: string }
  | { type: "set-ready"; ready: boolean }
  | { type: "set-settings"; settings: RoomSettings }
  | { type: "start-match" }
  | { type: "kick-player"; playerId: string }
  | { type: "play-again" };
export type ServerMessage =
  | { type: "welcome"; playerId: string; reconnectToken: string; room: RoomView }
  | { type: "room-update"; room: RoomView }
  | { type: "error"; message: string }
  | { type: "notice"; message: string };

export const defaultSettings = (): RoomSettings => ({ matchLengthMinutes: 30, collapseSpeed: "standard", friendlyFire: false });
export const makeRoomCode = (random: () => number = Math.random): string => Array.from({ length: 6 }, () => ROOM_CODE_ALPHABET[Math.floor(random() * ROOM_CODE_ALPHABET.length)]).join("");
export const normalizeName = (name: string): string => name.trim().replace(/\s+/g, " ").slice(0, 18);

