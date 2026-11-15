import type { ClientMessage, FigureLook, Hearth, RoomView, ServerMessage } from "@ashen-crown/shared";
import * as THREE from "three";
import { renderGame, handleVoiceSignal, updateVoiceVolumes, resetGameView } from "./game-view.js";
import type { GameState, GamePlayer, LootDrop } from "@ashen-crown/shared";
import { HEARTHS } from "@ashen-crown/shared";
import "./style.css";

const app = document.querySelector<HTMLDivElement>("#app")!;
const stored = localStorage.getItem("ashen-crown-player");
const saved = stored ? JSON.parse(stored) as { name?: string; hearth?: Hearth; look?: FigureLook; token?: string } : {};
let socket: WebSocket | undefined;
let room: RoomView | undefined;
let playerId = "";
let reconnectToken = saved.token ?? "";
let gameState: GameState | undefined;
let localVoice: MediaStream | undefined;
const voicePeers = new Map<string, RTCPeerConnection>();
const pendingIce = new Map<string, RTCIceCandidateInit[]>();
let voiceStatus = "Voice is off";

const esc = (value: string) => value.replace(/[&<>'"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" }[c]!));
const roomCodeFromUrl = () => new URLSearchParams(location.search).get("room")?.toUpperCase() ?? "";
function identityFields() { return `<label>Name<input id="name" maxlength="18" autocomplete="nickname" value="${esc(saved.name ?? "")}" placeholder="Your name" required></label><label>Hearth<select id="hearth">${HEARTHS.map(h => `<option value="${h}" ${saved.hearth === h ? "selected" : ""}>${h}</option>`).join("")}</select></label><label>Figure<select id="look">${["scout","warden","ranger","duelist"].map(l => `<option value="${l}" ${saved.look === l ? "selected" : ""}>${l}</option>`).join("")}</select></label>`; }
function formIdentity(): { name: string; hearth: Hearth; look: FigureLook } | undefined { const name = (document.querySelector<HTMLInputElement>("#name")?.value ?? "").trim(); if (!name) return undefined; return { name, hearth: document.querySelector<HTMLSelectElement>("#hearth")!.value as Hearth, look: document.querySelector<HTMLSelectElement>("#look")!.value as FigureLook }; }
function send(message: ClientMessage) { socket?.send(JSON.stringify(message)); }
function connect() { if (socket?.readyState === WebSocket.OPEN) return; const host = import.meta.env.DEV ? `${location.hostname}:3000` : location.host; socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${host}/ws`); socket.addEventListener("open", () => { if (!room) return; const identity = saved.name ? { name: saved.name, hearth: saved.hearth ?? "marsh", look: saved.look ?? "scout" } : undefined; if (identity) send({ type: "join-room", code: room.code, ...identity, reconnectToken }); }); socket.addEventListener("message", e => receive(JSON.parse(e.data) as ServerMessage)); socket.addEventListener("close", () => { if (room) setTimeout(connect, 1200); }); }
function receive(message: ServerMessage) { if (message.type === "error") return alert(message.message); if (message.type === "notice") return; if (message.type === "game-state") { gameState = message.state; render(); updateVoiceVolumes(); return; } if (message.type === "voice-signal") { void handleVoiceSignal(message.fromId, message.signal); return; } if (message.type === "welcome") { playerId = message.playerId; reconnectToken = message.reconnectToken; room = message.room; const identity = formIdentity() ?? { name: saved.name, hearth: saved.hearth, look: saved.look }; Object.assign(saved, identity, { token: reconnectToken }); localStorage.setItem("ashen-crown-player", JSON.stringify(saved)); history.replaceState({}, "", `?room=${room.code}`); } if (message.type === "room-update") { const wasPlaying = room?.phase !== "lobby"; room = message.room; if (room.phase === "lobby") { gameState = undefined; if (wasPlaying) resetGameView(); } } render(); }
function render() { if (room && gameState && (room.phase === "match" || room.phase === "ended")) { const me = room.players.find(p => p.id === playerId); renderGame(app, playerId, gameState, send, !!me?.isHost); return; } if (room && (room.phase === "starting" || room.phase === "match" || room.phase === "ended")) { renderArena(); return; } if (!room) { const code = roomCodeFromUrl(); app.innerHTML = `<main><p class="eyebrow">THE WINNOWING AWAITS</p><h1>ASHEN CROWN</h1><p class="lede">Open an invite. Pick a name. Play.</p><section class="card"><h2>${code ? `Join ${code}` : "Create a private room"}</h2>${identityFields()}<button id="primary">${code ? "Join room" : "Create room"}</button>${code ? "" : '<p class="join">Have a code? <input id="room-code" maxlength="6" placeholder="ABC123"> <button id="join">Join</button></p>'}</section></main>`; document.querySelector("#primary")?.addEventListener("click", () => { const identity = formIdentity(); if (!identity) return alert("Enter a name first."); connect(); socket!.addEventListener("open", () => send(code ? { type: "join-room", code, ...identity, reconnectToken } : { type: "create-room", ...identity }), { once: true }); }); document.querySelector("#join")?.addEventListener("click", () => { const codeInput = document.querySelector<HTMLInputElement>("#room-code")!.value.toUpperCase(); if (codeInput.length === 6) location.search = `?room=${codeInput}`; }); return; }
 const me = room.players.find(p => p.id === playerId); const invite = location.href; app.innerHTML = `<main><p class="eyebrow">PRIVATE ROOM Â· ${room.code}</p><h1>ASHEN CROWN</h1><section class="lobby"><div class="card"><h2>Invite the Kindled</h2><div class="invite"><input value="${esc(invite)}" readonly><button id="copy">Copy link</button></div><p class="muted">${room.players.length}/${room.maxPlayers} players Â· two ready players required to begin</p><h2>Settings</h2><label>Match length<select id="length" ${me?.isHost ? "" : "disabled"}><option value="20">20 min</option><option value="30" selected>30 min</option><option value="45">45 min</option></select></label><label>Collapse speed<select id="speed" ${me?.isHost ? "" : "disabled"}>${["slow","standard","fast"].map(v=>`<option value="${v}" ${room!.settings.collapseSpeed===v?"selected":""}>${v}</option>`).join("")}</select></label><label class="check"><input id="ff" type="checkbox" ${room.settings.friendlyFire ? "checked" : ""} ${me?.isHost ? "" : "disabled"}> Friendly fire</label></div><div class="card"><h2>Lobby</h2><ul>${room.players.map(p => `<li><span class="crest ${p.hearth}"></span><strong>${esc(p.name)}${p.isHost ? " Â· Host" : ""}</strong><small>${p.hearth} ${p.look} Â· ${p.connected ? (p.ready ? "Ready" : "Not ready") : "Reconnecting"}</small>${me?.isHost && !p.isHost ? `<button class="kick" data-id="${p.id}">Kick</button>` : ""}</li>`).join("")}</ul><button id="ready" class="secondary">${me?.ready ? "Cancel ready" : "Ready"}</button>${me?.isHost ? `<button id="start" ${room.players.filter(p=>p.ready && p.connected).length < room.minPlayers ? "disabled" : ""}>Begin Winnowing</button>` : ""}</div></section></main>`;
 document.querySelector("#copy")?.addEventListener("click", () => navigator.clipboard.writeText(invite)); document.querySelector("#ready")?.addEventListener("click", () => send({ type: "set-ready", ready: !me?.ready })); document.querySelector("#start")?.addEventListener("click", () => send({ type: "start-match" })); document.querySelectorAll<HTMLButtonElement>(".kick").forEach(b=>b.addEventListener("click",()=>send({type:"kick-player",playerId:b.dataset.id!}))); ["length","speed","ff"].forEach(id=>document.querySelector(`#${id}`)?.addEventListener("change",()=>send({type:"set-settings",settings:{matchLengthMinutes:Number((document.querySelector("#length") as HTMLSelectElement).value),collapseSpeed:(document.querySelector("#speed") as HTMLSelectElement).value as RoomView["settings"]["collapseSpeed"],friendlyFire:(document.querySelector("#ff") as HTMLInputElement).checked}})));
}

let arenaRenderer: THREE.WebGLRenderer | undefined;
let arenaCamera: THREE.PerspectiveCamera | undefined;
let gameRenderer: THREE.WebGLRenderer | undefined;
let gameCamera: THREE.PerspectiveCamera | undefined;
let gameScene: THREE.Scene | undefined;
const gamePlayerMeshes = new Map<string, THREE.Group>();
const gameLootMeshes = new Map<string, THREE.Mesh>();
const heldKeys = new Set<string>();
let gameLoopStarted = false;
let lastInputSent = 0;

function renderArena() {
  if (!room) return;
  if (!document.querySelector("#arena")) {
    app.innerHTML = "<div id='arena' style='position:fixed;inset:0;background:#151914;color:#f3ead7;overflow:hidden;font-family:monospace'><div style='position:absolute;z-index:2;left:0;right:0;top:0;padding:22px;text-align:center;background:linear-gradient(#111a,transparent)'><div style='letter-spacing:.25em;color:#d9bd79;font-size:11px'>THE REGENT COUNCIL PRESENTS</div><div style='font:700 clamp(34px,7vw,64px) Georgia;margin:8px'>ASHEN CROWN</div><div id='arena-status' style='font-size:14px;letter-spacing:.12em'>PREPARING THE WINNOWING</div><div id='arena-countdown' style='font-size:clamp(32px,6vw,54px);margin-top:8px;color:#e4c67c'></div></div><div style='position:absolute;z-index:2;bottom:0;left:0;right:0;padding:18px;text-align:center;background:linear-gradient(transparent,#111c);font-size:11px;color:#c7bda4'>BASE CAMP · SIX HEARTHS · QUILLWOOD</div></div>";
    const host = document.querySelector<HTMLDivElement>("#arena")!;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#a9a08a");
    scene.fog = new THREE.Fog("#a9a08a", 48, 105);
    arenaCamera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 180);
    arenaCamera.position.set(0, 31, 49);
    arenaCamera.lookAt(0, 0, 0);
    arenaRenderer = new THREE.WebGLRenderer({ antialias: window.innerWidth > 700 });
    arenaRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    arenaRenderer.setSize(window.innerWidth, window.innerHeight);
    arenaRenderer.shadowMap.enabled = true;
    arenaRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
    arenaRenderer.outputColorSpace = THREE.SRGBColorSpace;
    arenaRenderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
    host.prepend(arenaRenderer.domElement);
    scene.add(new THREE.HemisphereLight(0xf5e7c7, 0x344034, 2));
    const sun = new THREE.DirectionalLight(0xffe2a6, 2.6);
    sun.position.set(-22, 38, 15);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    scene.add(sun);

    const ground = new THREE.Mesh(new THREE.CylinderGeometry(37, 37, 1.2, 72), new THREE.MeshStandardMaterial({ color: "#514f3d", roughness: 1 }));
    ground.position.y = -0.7;
    ground.receiveShadow = true;
    scene.add(ground);

    const colors = ["#71836a", "#a85f43", "#385f4a", "#c6b58a", "#8ca9b4", "#8d665d"];
    for (let i = 0; i < 6; i++) {
      const start = i * Math.PI / 3 - Math.PI / 6;
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.lineTo(Math.cos(start) * 36, Math.sin(start) * 36);
      for (let j = 1; j <= 18; j++) {
        const a = start + Math.PI / 3 * j / 18;
        shape.lineTo(Math.cos(a) * 36, Math.sin(a) * 36);
      }
      shape.lineTo(0, 0);
      const tile = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ color: colors[i], roughness: 1, side: THREE.DoubleSide }));
      tile.rotation.x = -Math.PI / 2;
      tile.position.y = -0.05;
      tile.receiveShadow = true;
      scene.add(tile);

      const angle = i * Math.PI / 3;
      for (let t = 0; t < 7; t++) {
        const a = angle + (t - 3) * 0.12;
        const radius = 29 + (t % 3) * 1.6;
        const tree = new THREE.Group();
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, 2, 5), new THREE.MeshStandardMaterial({ color: "#514234" }));
        trunk.position.y = 1;
        const crown = new THREE.Mesh(new THREE.ConeGeometry(1.15, 3.2, 5), new THREE.MeshStandardMaterial({ color: colors[i] }));
        crown.position.y = 3;
        tree.add(trunk, crown);
        tree.position.set(Math.cos(a) * radius, 0, Math.sin(a) * radius);
        tree.traverse(o => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
        scene.add(tree);
      }
    }

    const camp = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 1.1, 6), new THREE.MeshStandardMaterial({ color: "#b99b61" }));
    camp.position.y = 0.25;
    camp.rotation.y = Math.PI / 6;
    camp.castShadow = true;
    scene.add(camp);
    const fire = new THREE.Mesh(new THREE.ConeGeometry(0.7, 2.4, 7), new THREE.MeshStandardMaterial({ color: "#e78b3d", emissive: "#8d3d12", emissiveIntensity: 0.9 }));
    fire.position.y = 2;
    scene.add(fire);
    const fireLight = new THREE.PointLight(0xff9a43, 18, 18);
    fireLight.position.y = 3;
    scene.add(fireLight);

    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6;
      const x = Math.cos(a) * 25;
      const z = Math.sin(a) * 25;
      const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.55, 0.65, 6), new THREE.MeshStandardMaterial({ color: "#d2c5a4" }));
      pedestal.position.set(x, 0.35, z);
      scene.add(pedestal);
      const figure = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.52, 1.35, 6), new THREE.MeshStandardMaterial({ color: colors[i % 6] }));
      body.position.y = 1.25;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.38, 8, 6), new THREE.MeshStandardMaterial({ color: "#d6b991" }));
      head.position.y = 2.15;
      const pack = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.62, 0.28), new THREE.MeshStandardMaterial({ color: "#514537" }));
      pack.position.set(0, 1.3, -0.36);
      figure.add(body, head, pack);
      figure.position.set(x, 0.68, z);
      figure.rotation.y = -a;
      scene.add(figure);
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(36.7, 0.18, 6, 128), new THREE.MeshStandardMaterial({ color: "#d7bd7c", emissive: "#6c5527", emissiveIntensity: 0.35 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.12;
    scene.add(ring);

    const resize = () => {
      if (!arenaCamera || !arenaRenderer) return;
      arenaCamera.aspect = window.innerWidth / window.innerHeight;
      arenaCamera.updateProjectionMatrix();
      arenaRenderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener("resize", resize);
    arenaRenderer.setAnimationLoop(() => { if (arenaRenderer && arenaCamera) arenaRenderer.render(scene, arenaCamera); });
  }
  const status = document.querySelector("#arena-status");
  const countdown = document.querySelector("#arena-countdown");
  if (room.phase === "starting") {
    if (status) status.textContent = "THE GATES OPEN IN";
    const seconds = Math.max(0, Math.ceil(((room.countdownEndsAt ?? Date.now()) - Date.now()) / 1000));
    if (countdown) countdown.textContent = String(seconds).padStart(2, "0");
    window.setTimeout(() => { if (room?.phase === "starting") renderArena(); }, 250);
  } else {
    if (status) status.textContent = "THE WINNOWING HAS BEGUN";
    if (countdown) countdown.textContent = "SURVIVE";
  }
}

render();

