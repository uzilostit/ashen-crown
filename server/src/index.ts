import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import type { ClientMessage, ServerMessage } from "@ashen-crown/shared";
import { RoomError, RoomManager, type Room } from "./rooms.js";
import { Auth } from "./auth.js";
import { GameEngine } from "./game.js";

const port = Number(process.env.PORT ?? 3000);
const rooms = new RoomManager();
const auth = new Auth(); void auth.initialize();
const game = new GameEngine();
const clients = new Map<WebSocket, { room: Room; playerId: string }>();
const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
const cookies = (value = "") => Object.fromEntries(value.split(";").map(v => v.trim().split(/=(.*)/s, 2)).filter(v => v.length === 2));
const setSession = (res: import("node:http").ServerResponse, id: string) => res.setHeader("set-cookie", `ac_session=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
const readJson = async (req: import("node:http").IncomingMessage) => JSON.parse(await new Promise<string>((resolve, reject) => { let body = ""; req.on("data", c => body += c); req.on("end", () => resolve(body)); req.on("error", reject); }));
const send = (ws: WebSocket, message: ServerMessage) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)); };
const broadcast = (room: Room) => { const message: ServerMessage = { type: "room-update", room: rooms.view(room) }; for (const [ws, state] of clients) if (state.room === room) send(ws, message); };
const broadcastGame = (room: Room) => { const state = game.snapshot(room.code); if (!state) return; const message: ServerMessage = { type: "game-state", state }; for (const [ws, client] of clients) if (client.room === room) send(ws, message); };
const http = createServer((req, res) => {
  if (req.url === "/auth/me") { const account = auth.get(cookies(req.headers.cookie).ac_session); res.writeHead(account ? 200 : 401, { "content-type": "application/json" }); res.end(JSON.stringify(account ? { name: account.name, email: account.email } : {})); return; }
  if (req.url === "/auth/register" || req.url === "/auth/login") { void readJson(req).then(async ({ email, name, password }) => { const session = req.url === "/auth/register" ? await auth.register(email, name, password) : await auth.login(email, password); setSession(res, session.id); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ name: session.name, email: session.email })); }).catch(error => { res.writeHead(400, { "content-type": "application/json" }); res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Sign-in failed." })); }); return; }
  const raw = req.url === "/" ? "/index.html" : (req.url ?? "/index.html").split("?")[0];
  const relative = normalize(raw).replace(/^([.][.][\\/])+/, "");
  const file = join(process.cwd(), "client", "dist", relative);
  const fallback = join(process.cwd(), "client", "dist", "index.html");
  const chosen = existsSync(file) && !raw.endsWith("/") ? file : fallback;
  if (!existsSync(chosen)) { res.writeHead(503, { "content-type": "text/plain" }); res.end("Run the Vite client in development, or build the client first."); return; }
  res.writeHead(200, { "content-type": types[extname(chosen)] ?? "application/octet-stream" }); createReadStream(chosen).pipe(res);
});
const wss = new WebSocketServer({ noServer: true });
http.on("upgrade", (request, socket, head) => { if (request.url?.split("?")[0] !== "/ws") return socket.destroy(); wss.handleUpgrade(request, socket, head, ws => wss.emit("connection", ws)); });
wss.on("connection", ws => {
  ws.on("message", data => {
    try {
      const message = JSON.parse(data.toString()) as ClientMessage;
      const current = clients.get(ws);
      if (message.type === "create-room") { if (current) throw new RoomError("Already in a room."); const { room, player } = rooms.create(message.name, message.hearth, message.look); clients.set(ws, { room, playerId: player.id }); send(ws, { type: "welcome", playerId: player.id, reconnectToken: player.reconnectToken, room: rooms.view(room) }); broadcast(room); return; }
      if (message.type === "join-room") { if (current) throw new RoomError("Already in a room."); const joined = rooms.join(message.code, message.name, message.hearth, message.look, message.reconnectToken); clients.set(ws, { room: joined.room, playerId: joined.player.id }); send(ws, { type: "welcome", playerId: joined.player.id, reconnectToken: joined.player.reconnectToken, room: rooms.view(joined.room) }); broadcast(joined.room); return; }
      if (!current) throw new RoomError("Create or join a room first.");
      if (message.type === "voice-signal") { const target=[...clients].find(([,c])=>c.room===current.room&&c.playerId===message.targetId); if(target) send(target[0],{type:"voice-signal",fromId:current.playerId,signal:message.signal}); return; }
      if (message.type === "game-input") { game.input(current.room.code, current.playerId, message.input); return; }
      if (message.type === "game-action") { game.action(current.room.code, current.playerId, message.action); broadcastGame(current.room); return; }
      rooms.update(current.room, current.playerId, message); broadcast(current.room);
    } catch (error) { send(ws, { type: "error", message: error instanceof Error ? error.message : "Invalid message." }); }
  });
  ws.on("close", () => { const state = clients.get(ws); clients.delete(ws); if (!state) return; rooms.disconnect(state.room, state.playerId); broadcast(state.room); });
});
setInterval(() => rooms.prune(), 10_000).unref();
setInterval(() => {
  for (const room of rooms.advance()) { if (room.phase === "match") game.start(room); broadcast(room); }
  for (const room of rooms.rooms.values()) if (room.phase === "match") { game.tick(room); broadcastGame(room); if (game.get(room.code)?.phase === "ended") { room.phase = "ended"; broadcast(room); } }
}, 50).unref();
http.listen(port, () => console.log(`ASHEN CROWN server at http://localhost:${port}`));

