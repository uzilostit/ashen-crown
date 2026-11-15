import * as THREE from "three";
import type { ClientMessage, GameState, RTCSignal } from "@ashen-crown/shared";

type Send = (message: ClientMessage) => void;
let renderer: THREE.WebGLRenderer | undefined;
let scene: THREE.Scene | undefined;
let camera: THREE.PerspectiveCamera | undefined;
let current: GameState | undefined;
let selfId = "";
let sendMessage: Send = () => {};
let root: HTMLElement | undefined;
let inputTimer = 0;
let lastInput = 0;
const keys = new Set<string>();
const figures = new Map<string, THREE.Group>();
const drops = new Map<string, THREE.Mesh>();
const peers = new Map<string, RTCPeerConnection>();
const queuedIce = new Map<string, RTCIceCandidateInit[]>();
const queuedSignals = new Map<string, RTCSignal>();
let mic: MediaStream | undefined;
let voiceLabel = "Voice off";

const color: Record<string,string> = {marsh:"#71836a",cinder:"#a85f43",pine:"#385f4a",salt:"#c6b58a",frost:"#8ca9b4",orchard:"#8d665d"};
const dist=(a:{x:number;z:number},b:{x:number;z:number})=>Math.hypot(a.x-b.x,a.z-b.z);

export function renderGame(host:HTMLElement,id:string,state:GameState,send:Send,isHost:boolean){
  selfId=id;current=state;sendMessage=send;root=host;
  if(!document.querySelector("#game")) mount(isHost);
  updateScene();updateHud(isHost);
}
function mount(isHost:boolean){
  if(!root)return;
  root.innerHTML=`<div id="game" class="game-screen"><div class="game-top"><div><span class="game-kicker">THE REGENT COUNCIL PRESENTS</span><strong>ASHEN CROWN</strong></div><div id="game-message">Quillwood is watching.</div></div><div class="game-bottom"><div class="stat-panel" id="stats"></div><div class="inventory-panel" id="inventory"></div><div class="game-actions"><button id="attack">STRIKE</button><button id="loot">LOOT</button><button id="flare">FLARE</button><button id="ally">ALLY</button><button id="voice">VOICE</button><button id="ping">PING</button></div></div><div class="touch-pad"><button data-key="w">▲</button><div><button data-key="a">◀</button><button data-key="s">▼</button><button data-key="d">▶</button></div><button data-key="shift" class="sprint">RUN</button></div><div id="game-result" class="game-result" hidden></div></div>`;
  scene=new THREE.Scene();scene.background=new THREE.Color("#a9a08a");scene.fog=new THREE.Fog("#a9a08a",45,105);
  camera=new THREE.PerspectiveCamera(54,innerWidth/innerHeight,.1,180);
  renderer=new THREE.WebGLRenderer({antialias:innerWidth>700});renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.setSize(innerWidth,innerHeight);renderer.shadowMap.enabled=true;renderer.domElement.className="game-canvas";document.querySelector("#game")!.prepend(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xf4e8ce,0x354033,2.1));const sun=new THREE.DirectionalLight(0xffe0ac,2.2);sun.position.set(-20,35,12);sun.castShadow=true;scene.add(sun);
  const floor=new THREE.Mesh(new THREE.CircleGeometry(44,72),new THREE.MeshStandardMaterial({color:"#59624a",roughness:1}));floor.rotation.x=-Math.PI/2;floor.position.y=-.12;floor.receiveShadow=true;scene.add(floor);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(40,.22,6,128),new THREE.MeshBasicMaterial({color:"#e8d28a"}));ring.rotation.x=Math.PI/2;ring.position.y=.2;ring.name="safe-ring";scene.add(ring);
  const camp=new THREE.Mesh(new THREE.CylinderGeometry(5.5,6,1,6),new THREE.MeshStandardMaterial({color:"#b99b61"}));camp.position.y=.4;camp.rotation.y=Math.PI/6;scene.add(camp);
  const fire=new THREE.Mesh(new THREE.ConeGeometry(.6,2.2,7),new THREE.MeshStandardMaterial({color:"#e78b3d",emissive:"#8d3d12",emissiveIntensity:1}));fire.position.y=1.9;scene.add(fire);
  for(let i=0;i<6;i++){const a=i*Math.PI/3;for(let j=0;j<9;j++){const r=31+(j%3)*2.2;const tree=new THREE.Group();const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.16,.28,1.8,5),new THREE.MeshStandardMaterial({color:"#594735"}));trunk.position.y=.9;const crown=new THREE.Mesh(new THREE.ConeGeometry(1.1,3,5),new THREE.MeshStandardMaterial({color:Object.values(color)[i]}));crown.position.y=2.8;tree.add(trunk,crown);tree.position.set(Math.cos(a+(j-4)*.09)*r,0,Math.sin(a+(j-4)*.09)*r);scene!.add(tree);}}
  const resize=()=>{if(!camera||!renderer)return;camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);};window.addEventListener("resize",resize);
  window.addEventListener("keydown",e=>{const k=e.key.toLowerCase();if(["w","a","s","d","arrowup","arrowdown","arrowleft","arrowright","shift"].includes(k)){keys.add(k);e.preventDefault();}});
  window.addEventListener("keyup",e=>keys.delete(e.key.toLowerCase()));
  document.querySelectorAll<HTMLButtonElement>("[data-key]").forEach(b=>{const k=b.dataset.key!;b.addEventListener("pointerdown",e=>{e.preventDefault();keys.add(k);});for(const ev of ["pointerup","pointerleave","pointercancel"])b.addEventListener(ev,()=>keys.delete(k));});
  document.querySelector("#attack")?.addEventListener("click",attack);
  document.querySelector("#loot")?.addEventListener("click",loot);
  document.querySelector("#flare")?.addEventListener("click",()=>sendMessage({type:"game-action",action:current?.phase==="helicopter"?{type:"board-helicopter"}:{type:"flare"}}));
  document.querySelector("#ally")?.addEventListener("click",invite);
  document.querySelector("#ping")?.addEventListener("click",()=>sendMessage({type:"game-action",action:{type:"emote",text:"Enemy spotted"}}));
  const voice=document.querySelector<HTMLButtonElement>("#voice");voice?.addEventListener("click",()=>{if(!mic)void enableVoice();});
  voice?.addEventListener("pointerdown",()=>{if(mic)for(const t of mic.getAudioTracks())t.enabled=true;});
  for(const ev of ["pointerup","pointerleave","pointercancel"])voice?.addEventListener(ev,()=>{if(mic)for(const t of mic.getAudioTracks())t.enabled=false;});
  if(!inputTimer)inputTimer=window.setInterval(sendInput,50);
  renderer.setAnimationLoop(()=>{if(!renderer||!scene||!camera||!current)return;const me=current.players.find(p=>p.id===selfId);const target=me?.alive?me:current.players.filter(p=>p.alive&&!p.escaped).sort((a,b)=>dist(a,me??a)-dist(b,me??b))[0];if(target){camera.position.lerp(new THREE.Vector3(target.x,17,target.z+20),.09);camera.lookAt(target.x,0,target.z);}renderer.render(scene,camera);});
}
function sendInput(){if(!current)return;const x=(keys.has("d")||keys.has("arrowright")?1:0)-(keys.has("a")||keys.has("arrowleft")?1:0);const z=(keys.has("s")||keys.has("arrowdown")?1:0)-(keys.has("w")||keys.has("arrowup")?1:0);const now=performance.now();if(now-lastInput<45)return;lastInput=now;sendMessage({type:"game-input",input:{x,z,yaw:Math.atan2(x,z),sprint:keys.has("shift")}});}
function attack(){const me=current?.players.find(p=>p.id===selfId);const target=current?.players.filter(p=>p.alive&&p.id!==selfId).sort((a,b)=>dist(a,me??a)-dist(b,me??b))[0];if(target)sendMessage({type:"game-action",action:{type:"attack",targetId:target.id}});}
function loot(){const me=current?.players.find(p=>p.id===selfId);const d=current?.loot.slice().sort((a,b)=>dist(a,me??a)-dist(b,me??b))[0];if(d)sendMessage({type:"game-action",action:{type:"loot",dropId:d.id}});}
function invite(){const me=current?.players.find(p=>p.id===selfId);const target=current?.players.filter(p=>p.alive&&p.id!==selfId).sort((a,b)=>dist(a,me??a)-dist(b,me??b))[0];if(target)sendMessage({type:"game-action",action:{type:"ally-invite",targetId:target.id}});}
function updateScene(){
 if(!scene||!current)return;
 for(const p of current.players){let mesh=figures.get(p.id);if(!mesh){mesh=new THREE.Group();const body=new THREE.Mesh(new THREE.CylinderGeometry(.38,.48,1.25,6),new THREE.MeshStandardMaterial({color:color[p.hearth]??"#777"}));body.position.y=.85;const head=new THREE.Mesh(new THREE.SphereGeometry(.3,8,6),new THREE.MeshStandardMaterial({color:"#d6b991"}));head.position.y=1.65;mesh.add(body,head);scene.add(mesh);figures.set(p.id,mesh);}mesh.position.set(p.x,0,p.z);mesh.rotation.y=p.yaw;mesh.visible=p.alive&&!p.escaped;}
 const ids=new Set(current.players.map(p=>p.id));for(const [id,m] of figures)if(!ids.has(id)){scene.remove(m);figures.delete(id);}
 const lootIds=new Set(current.loot.map(d=>d.id));for(const d of current.loot){if(!drops.has(d.id)){const m=new THREE.Mesh(new THREE.BoxGeometry(.55,.55,.55),new THREE.MeshStandardMaterial({color:"#d5b86d"}));m.position.set(d.x,.35,d.z);scene.add(m);drops.set(d.id,m);}}for(const [id,m] of drops)if(!lootIds.has(id)){scene.remove(m);drops.delete(id);}
 const ring=scene.getObjectByName("safe-ring") as THREE.Mesh;if(ring.geometry)ring.geometry.dispose();ring.geometry=new THREE.TorusGeometry(current.zone.safeRadius,.22,6,128);
}
function updateHud(isHost:boolean){
 if(!current||!root)return;const me=current.players.find(p=>p.id===selfId);if(!me)return;
 const stats=document.querySelector("#stats");if(stats)stats.innerHTML=`<span>♥ ${Math.ceil(me.health)}</span><span>FOOD ${Math.ceil(me.hunger)}</span><span>WATER ${Math.ceil(me.thirst)}</span><span>STAMINA ${Math.ceil(me.stamina)}</span><span>ALIVE ${current.players.filter(p=>p.alive&&!p.escaped).length}</span>`;
 const inv=document.querySelector("#inventory");if(inv){inv.innerHTML=me.inventory.map((s,i)=>`<button data-slot="${i}">${i+1}. ${s.item} ×${s.count}</button>`).join("");inv.querySelectorAll<HTMLButtonElement>("[data-slot]").forEach(b=>b.addEventListener("click",()=>sendMessage({type:"game-action",action:{type:"use",slot:Number(b.dataset.slot)}})));}
 const invite=current.allianceInvites.find(x=>x.toId===selfId);let accept=document.querySelector<HTMLButtonElement>("#accept-ally");if(invite&&!accept){accept=document.createElement("button");accept.id="accept-ally";accept.textContent="ACCEPT PACT";document.querySelector(".game-actions")?.append(accept);}if(accept){accept.hidden=!invite;accept.onclick=()=>{if(invite)sendMessage({type:"game-action",action:{type:"ally-respond",fromId:invite.fromId,accept:true}});};}
 const leave=document.querySelector<HTMLButtonElement>("#leave-ally");if(me.allianceId&&!leave){const b=document.createElement("button");b.id="leave-ally";b.textContent="LEAVE PACT";b.onclick=()=>sendMessage({type:"game-action",action:{type:"leave-alliance"}});document.querySelector(".game-actions")?.append(b);}if(leave)leave.hidden=!me.allianceId;
 const msg=document.querySelector("#game-message");if(msg)msg.textContent=current.message+" · "+voiceLabel;
 const flare=document.querySelector<HTMLButtonElement>("#flare");if(flare)flare.textContent=current.phase==="helicopter"?"BOARD":"FLARE";
 const result=document.querySelector<HTMLDivElement>("#game-result");if(current.phase==="ended"&&result){result.hidden=false;result.innerHTML=`<div class="result-card"><p class="game-kicker">THE WINNOWING IS OVER</p><h2>${current.winnerId===selfId?"YOU SURVIVED":"THE CROWN HAS CHOSEN"}</h2><p>${current.message}</p>${isHost?'<button id="again">PLAY AGAIN</button>':"<p>Waiting for the host to start another round.</p>"}</div>`;document.querySelector("#again")?.addEventListener("click",()=>sendMessage({type:"play-again"}));}
 updateVoiceVolumes();
}
async function enableVoice(){try{mic=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});for(const t of mic.getAudioTracks())t.enabled=false;voiceLabel="Voice ready · hold VOICE to talk";const peersNow=current?.players.filter(p=>p.id!==selfId)??[];for(const p of peersNow)if(selfId.localeCompare(p.id)<0)await makePeer(p.id,true);for(const [id,signal] of queuedSignals){queuedSignals.delete(id);await handleVoiceSignal(id,signal);}const b=document.querySelector("#voice");if(b)b.textContent="HOLD TO TALK";}catch{voiceLabel="Mic unavailable · use PING";const b=document.querySelector("#voice");if(b)b.textContent="VOICE OFF";}}
async function makePeer(id:string,offer:boolean){if(!mic||peers.has(id))return;const pc=new RTCPeerConnection({iceServers:[]});peers.set(id,pc);for(const t of mic.getTracks())pc.addTrack(t,mic);pc.onicecandidate=e=>{if(e.candidate)sendMessage({type:"voice-signal",targetId:id,signal:{type:"candidate",candidate:e.candidate.candidate,sdpMid:e.candidate.sdpMid,sdpMLineIndex:e.candidate.sdpMLineIndex}});};pc.ontrack=e=>{let audio=document.querySelector<HTMLAudioElement>(`audio[data-peer="${id}"]`);if(!audio){audio=document.createElement("audio");audio.autoplay=true;audio.dataset.peer=id;document.body.append(audio);}audio.srcObject=e.streams[0];void audio.play().catch(()=>{});updateVoiceVolumes();};pc.onconnectionstatechange=()=>{if(pc.connectionState==="failed"||pc.connectionState==="disconnected")voiceLabel="Voice link unavailable · use PING";};if(offer){const d=await pc.createOffer();await pc.setLocalDescription(d);sendMessage({type:"voice-signal",targetId:id,signal:{type:"offer",sdp:d.sdp}});}}
export async function handleVoiceSignal(id:string,signal:RTCSignal){if(!mic){queuedSignals.set(id,signal);return;}let pc=peers.get(id);if(!pc)await makePeer(id,false);pc=peers.get(id);if(!pc)return;try{if(signal.type==="offer"&&signal.sdp){await pc.setRemoteDescription({type:"offer",sdp:signal.sdp});for(const c of queuedIce.get(id)??[])await pc.addIceCandidate(c);queuedIce.delete(id);const a=await pc.createAnswer();await pc.setLocalDescription(a);sendMessage({type:"voice-signal",targetId:id,signal:{type:"answer",sdp:a.sdp}});}else if(signal.type==="answer"&&signal.sdp){await pc.setRemoteDescription({type:"answer",sdp:signal.sdp});for(const c of queuedIce.get(id)??[])await pc.addIceCandidate(c);queuedIce.delete(id);}else if(signal.type==="candidate"&&signal.candidate){const c={candidate:signal.candidate,sdpMid:signal.sdpMid,sdpMLineIndex:signal.sdpMLineIndex};if(pc.remoteDescription)await pc.addIceCandidate(c);else queuedIce.set(id,[...(queuedIce.get(id)??[]),c]);}}catch{voiceLabel="Voice link unavailable · use PING";}}
export function updateVoiceVolumes(){if(!current)return;const me=current.players.find(p=>p.id===selfId);if(!me)return;document.querySelectorAll<HTMLAudioElement>("audio[data-peer]").forEach(a=>{const p=current!.players.find(x=>x.id===a.dataset.peer);if(p)a.volume=Math.max(0,Math.min(1,1-dist(p,me)/30));});}

export function resetGameView(){
 if(inputTimer){clearInterval(inputTimer);inputTimer=0;}
 renderer?.setAnimationLoop(null);renderer?.dispose();renderer=undefined;scene=undefined;camera=undefined;current=undefined;
 for(const pc of peers.values())pc.close();peers.clear();queuedIce.clear();queuedSignals.clear();
 if(mic){for(const t of mic.getTracks())t.stop();mic=undefined;}
 document.querySelectorAll<HTMLAudioElement>("audio[data-peer]").forEach(a=>{a.pause();a.srcObject=null;a.remove();});
 figures.clear();drops.clear();keys.clear();
}
