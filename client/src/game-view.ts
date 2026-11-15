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
const snares = new Map<string, THREE.Mesh>();
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
  root.innerHTML=`<div id="game" class="game-screen"><div class="game-top"><div><span class="game-kicker">THE REGENT COUNCIL PRESENTS</span><strong>ASHEN CROWN</strong></div><div id="game-message">Quillwood is watching.</div><canvas id="minimap" width="160" height="160" aria-label="Arena minimap"></canvas></div><div class="game-bottom"><div class="stat-panel" id="stats"></div><div class="inventory-panel" id="inventory"></div><div class="game-actions"><button id="attack">STRIKE</button><button id="loot">LOOT</button><button id="flare">FLARE</button><button id="ally">ALLY</button><button id="voice">VOICE</button><button id="ping">PING</button><button id="gift">GIFT</button></div></div><div class="touch-pad"><button data-key="w">▲</button><div><button data-key="a">◀</button><button data-key="s">▼</button><button data-key="d">▶</button></div><button data-key="shift" class="sprint">RUN</button><button data-key="q" class="sprint">BLOCK</button><button data-key=" " class="sprint">DODGE</button></div><div id="game-result" class="game-result" hidden></div></div>`;
  scene=new THREE.Scene();scene.background=new THREE.Color("#a9a08a");scene.fog=new THREE.Fog("#a9a08a",45,105);
  camera=new THREE.PerspectiveCamera(48,innerWidth/innerHeight,.1,420);
  renderer=new THREE.WebGLRenderer({antialias:innerWidth>700});renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.setSize(innerWidth,innerHeight);renderer.shadowMap.enabled=true;renderer.domElement.className="game-canvas";document.querySelector("#game")!.prepend(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xf4e8ce,0x354033,2.1));const sun=new THREE.DirectionalLight(0xffe0ac,2.2);sun.position.set(-20,35,12);sun.castShadow=true;scene.add(sun);
  const floor=new THREE.Mesh(new THREE.CircleGeometry(92,128),new THREE.MeshStandardMaterial({color:"#59624a",roughness:1}));floor.rotation.x=-Math.PI/2;floor.position.y=-.12;floor.receiveShadow=true;scene.add(floor);
  const biomes=["#71836a","#a85f43","#385f4a","#c6b58a","#8ca9b4","#8d665d"];
  for(let i=0;i<6;i++){const start=i*Math.PI/3-Math.PI/6;const shape=new THREE.Shape();shape.moveTo(0,0);shape.lineTo(Math.cos(start)*90,Math.sin(start)*90);for(let j=1;j<=20;j++){const a=start+Math.PI/3*j/20;shape.lineTo(Math.cos(a)*90,Math.sin(a)*90);}shape.lineTo(0,0);const tile=new THREE.Mesh(new THREE.ShapeGeometry(shape),new THREE.MeshStandardMaterial({color:biomes[i],roughness:1,side:THREE.DoubleSide,transparent:true,opacity:.82}));tile.rotation.x=-Math.PI/2;tile.position.y=-.04;tile.receiveShadow=true;scene.add(tile);}
  // Ancient radial causeways, broken boundary walls, and six biome landmarks give the arena a readable sense of scale.
  for(let i=0;i<6;i++){
    const a=i*Math.PI/3;
    const road=new THREE.Mesh(new THREE.BoxGeometry(5.5,.12,62),new THREE.MeshStandardMaterial({color:"#82765a",roughness:1}));
    road.position.set(Math.cos(a)*39,.015,Math.sin(a)*39);road.rotation.y=-a;scene!.add(road);
    const plinth=new THREE.Mesh(new THREE.CylinderGeometry(3.1,4.2,2.4,7),new THREE.MeshStandardMaterial({color:"#625c4a",roughness:1}));
    plinth.position.set(Math.cos(a)*76,1.2,Math.sin(a)*76);scene!.add(plinth);
    const shard=new THREE.Mesh(new THREE.DodecahedronGeometry(3.2,0),new THREE.MeshStandardMaterial({color:["#829077","#b16a4b","#466d58","#d4c49b","#9cbac5","#a87970"][i],roughness:1,flatShading:true}));
    shard.scale.set(.7,1.8,.7);shard.position.set(Math.cos(a)*76,4.2,Math.sin(a)*76);scene!.add(shard);
    for(let j=0;j<5;j++){const x=Math.cos(a)* (44+j*5),z=Math.sin(a)*(44+j*5);const stone=new THREE.Mesh(new THREE.BoxGeometry(2.2,1.1,1.8),new THREE.MeshStandardMaterial({color:"#716b58",roughness:1}));stone.position.set(x,.45,z);stone.rotation.y=a+j*.7;scene!.add(stone);}
  }
  // Scatter deterministic rock clusters and scrub so the terrain is not a set of six flat wedges.
  for(let i=0;i<180;i++){
    const angle=i*2.399963, radius=17+(i*37%6900)/100;
    if(radius>87)continue;
    const x=Math.cos(angle)*radius,z=Math.sin(angle)*radius;
    const rock=new THREE.Mesh(new THREE.DodecahedronGeometry(.45+(i%5)*.16,0),new THREE.MeshStandardMaterial({color:i%3===0?"#77715e":"#555b49",roughness:1,flatShading:true}));
    rock.position.set(x,.25,z);rock.rotation.set(i*.3,i*.7,i*.2);rock.scale.y=.55;scene!.add(rock);
    if(i%3===0){const shrub=new THREE.Mesh(new THREE.IcosahedronGeometry(.65+(i%4)*.12,0),new THREE.MeshStandardMaterial({color:i%2?"#465c40":"#68734b",roughness:1,flatShading:true}));shrub.position.set(x+1,.45,z-.8);shrub.scale.y=.65;scene!.add(shrub);}
  }
  // A shallow dark-water moat and a broken outer ring frame the playable island.
  const moat=new THREE.Mesh(new THREE.TorusGeometry(96,5,8,192),new THREE.MeshStandardMaterial({color:"#34494a",roughness:.35,metalness:.12,transparent:true,opacity:.9}));
  moat.rotation.x=Math.PI/2;moat.position.y=-.45;scene!.add(moat);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(88,.32,8,192),new THREE.MeshBasicMaterial({color:"#e8d28a"}));ring.rotation.x=Math.PI/2;ring.position.y=.2;ring.name="safe-ring";scene.add(ring);
  const camp=new THREE.Mesh(new THREE.CylinderGeometry(11,12,2,8),new THREE.MeshStandardMaterial({color:"#b99b61"}));camp.position.y=.8;camp.rotation.y=Math.PI/6;scene.add(camp);
  const fire=new THREE.Mesh(new THREE.ConeGeometry(1.2,4.4,9),new THREE.MeshStandardMaterial({color:"#e78b3d",emissive:"#8d3d12",emissiveIntensity:1}));fire.position.y=3.8;scene.add(fire);
  for(let i=0;i<6;i++){const a=i*Math.PI/3;for(let j=0;j<18;j++){const r=58+(j%5)*5;const tree=new THREE.Group();const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.16,.28,1.8,5),new THREE.MeshStandardMaterial({color:"#594735"}));trunk.position.y=.9;const crown=new THREE.Mesh(new THREE.ConeGeometry(1.1,3,5),new THREE.MeshStandardMaterial({color:Object.values(color)[i]}));crown.position.y=2.8;tree.add(trunk,crown);tree.position.set(Math.cos(a+(j-8.5)*.045)*r,0,Math.sin(a+(j-4)*.09)*r);scene!.add(tree);}}
  const resize=()=>{if(!camera||!renderer)return;camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);};window.addEventListener("resize",resize);
  window.addEventListener("keydown",e=>{const k=e.key.toLowerCase();if(["w","a","s","d","arrowup","arrowdown","arrowleft","arrowright","shift","q"," "].includes(k)){keys.add(k);e.preventDefault();}});
  window.addEventListener("keyup",e=>keys.delete(e.key.toLowerCase()));
  document.querySelectorAll<HTMLButtonElement>("[data-key]").forEach(b=>{const k=b.dataset.key!;b.addEventListener("pointerdown",e=>{e.preventDefault();keys.add(k);});for(const ev of ["pointerup","pointerleave","pointercancel"])b.addEventListener(ev,()=>keys.delete(k));});
  document.querySelector("#attack")?.addEventListener("click",attack);
  document.querySelector("#loot")?.addEventListener("click",loot);
  document.querySelector("#flare")?.addEventListener("click",()=>sendMessage({type:"game-action",action:current?.phase==="helicopter"?{type:"board-helicopter"}:{type:"flare"}}));
  document.querySelector("#ally")?.addEventListener("click",invite);
  document.querySelector("#ping")?.addEventListener("click",()=>sendMessage({type:"game-action",action:current?.players.find(p=>p.id===selfId)?.alive?{type:"emote",text:"Enemy spotted"}:{type:"spectator-chat",text:"Good luck, Kindled"}}));
  document.querySelector("#gift")?.addEventListener("click",()=>{const me=current?.players.find(p=>p.id===selfId);const target=current?.players.filter(p=>p.alive).sort((a,b)=>dist(a,me??a)-dist(b,me??b))[0];if(me&&!me.alive&&target)sendMessage({type:"game-action",action:{type:"spectator-gift",targetId:target.id,item:"ration"}});});
  const voice=document.querySelector<HTMLButtonElement>("#voice");voice?.addEventListener("click",()=>{if(!mic)void enableVoice();});
  voice?.addEventListener("pointerdown",()=>{if(mic)for(const t of mic.getAudioTracks())t.enabled=true;});
  for(const ev of ["pointerup","pointerleave","pointercancel"])voice?.addEventListener(ev,()=>{if(mic)for(const t of mic.getAudioTracks())t.enabled=false;});
  if(!inputTimer)inputTimer=window.setInterval(sendInput,50);
  renderer.setAnimationLoop(()=>{if(!renderer||!scene||!camera||!current)return;const me=current.players.find(p=>p.id===selfId);const target=me?.alive?me:current.players.filter(p=>p.alive&&!p.escaped).sort((a,b)=>dist(a,me??a)-dist(b,me??b))[0];if(target){camera.position.lerp(new THREE.Vector3(target.x*2,18,target.z*2+23),.12);camera.lookAt(target.x*2,1.1,target.z*2);}renderer.render(scene,camera);});
}
function sendInput(){if(!current)return;const x=(keys.has("d")||keys.has("arrowright")?1:0)-(keys.has("a")||keys.has("arrowleft")?1:0);const z=(keys.has("s")||keys.has("arrowdown")?1:0)-(keys.has("w")||keys.has("arrowup")?1:0);const now=performance.now();if(now-lastInput<45)return;lastInput=now;sendMessage({type:"game-input",input:{x,z,yaw:Math.atan2(x,z),sprint:keys.has("shift"),block:keys.has("q"),dodge:keys.has(" ")}});}
function attack(){const me=current?.players.find(p=>p.id===selfId);const target=current?.players.filter(p=>p.alive&&p.id!==selfId).sort((a,b)=>dist(a,me??a)-dist(b,me??b))[0];if(target)sendMessage({type:"game-action",action:{type:"attack",targetId:target.id}});}
function loot(){const me=current?.players.find(p=>p.id===selfId);const d=current?.loot.slice().sort((a,b)=>dist(a,me??a)-dist(b,me??b))[0];if(d)sendMessage({type:"game-action",action:{type:"loot",dropId:d.id}});}
function invite(){const me=current?.players.find(p=>p.id===selfId);const target=current?.players.filter(p=>p.alive&&p.id!==selfId).sort((a,b)=>dist(a,me??a)-dist(b,me??b))[0];if(target)sendMessage({type:"game-action",action:{type:"ally-invite",targetId:target.id}});}
function updateScene(){
 if(!scene||!current)return;
 for(const p of current.players){let mesh=figures.get(p.id);if(!mesh){mesh=new THREE.Group();const paper=new THREE.MeshStandardMaterial({color:color[p.hearth]??"#777",roughness:1,flatShading:true});const body=new THREE.Mesh(new THREE.BoxGeometry(.72,1.05,.34),paper);body.position.y=.88;const head=new THREE.Mesh(new THREE.DodecahedronGeometry(.31,0),new THREE.MeshStandardMaterial({color:"#d6b991",roughness:1,flatShading:true}));head.position.y=1.62;const jointMat=new THREE.MeshStandardMaterial({color:"#c3aa87",roughness:1,flatShading:true});const armL=new THREE.Mesh(new THREE.BoxGeometry(.18,.78,.2),paper);armL.position.set(-.48,.9,0);armL.rotation.z=-.18;const armR=armL.clone();armR.position.x=.48;armR.rotation.z=.18;const legL=new THREE.Mesh(new THREE.BoxGeometry(.23,.72,.25),paper);legL.position.set(-.2,.18,0);const legR=legL.clone();legR.position.x=.2;const pack=new THREE.Mesh(new THREE.BoxGeometry(.42,.52,.22),new THREE.MeshStandardMaterial({color:"#514537",roughness:1,flatShading:true}));pack.position.set(0,1,-.28);const joint=new THREE.Mesh(new THREE.IcosahedronGeometry(.13,0),jointMat);joint.position.set(0,1.32,0);mesh.add(body,head,armL,armR,legL,legR,pack,joint);scene.add(mesh);figures.set(p.id,mesh);}mesh.position.set(p.x*2,0,p.z*2);mesh.scale.setScalar(1.35);mesh.rotation.y=p.yaw;mesh.visible=p.alive&&!p.escaped;}
 const ids=new Set(current.players.map(p=>p.id));for(const [id,m] of figures)if(!ids.has(id)){scene.remove(m);figures.delete(id);}
 const lootIds=new Set(current.loot.map(d=>d.id));for(const d of current.loot){if(!drops.has(d.id)){const m=new THREE.Mesh(new THREE.BoxGeometry(.55,.55,.55),new THREE.MeshStandardMaterial({color:"#d5b86d"}));m.position.set(d.x*2,.7,d.z*2);m.scale.setScalar(1.7);scene.add(m);drops.set(d.id,m);}}for(const [id,m] of drops)if(!lootIds.has(id)){scene.remove(m);drops.delete(id);}
 const trapIds=new Set(current.traps.map(t=>t.id));for(const t of current.traps){if(!snares.has(t.id)){const m=new THREE.Mesh(new THREE.TorusGeometry(.8,.09,5,16),new THREE.MeshStandardMaterial({color:"#a34f39"}));m.rotation.x=Math.PI/2;m.position.set(t.x*2,.24,t.z*2);m.scale.setScalar(2);scene.add(m);snares.set(t.id,m);}}for(const [id,m] of snares)if(!trapIds.has(id)){scene.remove(m);snares.delete(id);}
 const ring=scene.getObjectByName("safe-ring") as THREE.Mesh;if(ring.geometry)ring.geometry.dispose();ring.geometry=new THREE.TorusGeometry(current.zone.safeRadius*2,.38,8,192);
}
function updateHud(isHost:boolean){
 if(!current||!root)return;const me=current.players.find(p=>p.id===selfId);if(!me)return;
 const stats=document.querySelector("#stats");if(stats)stats.innerHTML=`${!me.alive?`<span>SPECTATING · PATRON ${me.patronPoints}</span>`:""}<span>♥ ${Math.ceil(me.health)}</span><span>FOOD ${Math.ceil(me.hunger)}</span><span>WATER ${Math.ceil(me.thirst)}</span><span>STAMINA ${Math.ceil(me.stamina)}</span><span>ALIVE ${current.players.filter(p=>p.alive&&!p.escaped).length}</span>`;
 const inv=document.querySelector("#inventory");if(inv){inv.innerHTML=me.inventory.map((s,i)=>`<button data-slot="${i}">${i+1}. ${s.item} ×${s.count}</button>`).join("");inv.querySelectorAll<HTMLButtonElement>("[data-slot]").forEach(b=>b.addEventListener("click",()=>sendMessage({type:"game-action",action:{type:"use",slot:Number(b.dataset.slot)}})));}
 const invite=current.allianceInvites.find(x=>x.toId===selfId);let accept=document.querySelector<HTMLButtonElement>("#accept-ally");if(invite&&!accept){accept=document.createElement("button");accept.id="accept-ally";accept.textContent="ACCEPT PACT";document.querySelector(".game-actions")?.append(accept);}if(accept){accept.hidden=!invite;accept.onclick=()=>{if(invite)sendMessage({type:"game-action",action:{type:"ally-respond",fromId:invite.fromId,accept:true}});};}
 const leave=document.querySelector<HTMLButtonElement>("#leave-ally");if(me.allianceId&&!leave){const b=document.createElement("button");b.id="leave-ally";b.textContent="LEAVE PACT";b.onclick=()=>sendMessage({type:"game-action",action:{type:"leave-alliance"}});document.querySelector(".game-actions")?.append(b);}if(leave)leave.hidden=!me.allianceId;
 const map=document.querySelector<HTMLCanvasElement>("#minimap");if(map){const ctx=map.getContext("2d");if(ctx){ctx.clearRect(0,0,160,160);ctx.fillStyle="#171b16e8";ctx.beginPath();ctx.arc(80,80,75,0,Math.PI*2);ctx.fill();ctx.strokeStyle="#c5b078";ctx.lineWidth=2;ctx.beginPath();for(let i=0;i<6;i++){const a=i*Math.PI/3-Math.PI/6,x=80+Math.cos(a)*70,y=80+Math.sin(a)*70;i?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.closePath();ctx.stroke();ctx.strokeStyle="#f0d98c";ctx.beginPath();ctx.arc(80,80,Math.max(3,current.zone.safeRadius/44*70),0,Math.PI*2);ctx.stroke();for(const p of current.players.filter(x=>x.alive&&!x.escaped)){ctx.fillStyle=p.id===selfId?"#fff4c9":p.allianceId&&p.allianceId===me.allianceId?"#77d9a0":"#e36b57";ctx.beginPath();ctx.arc(80+p.x/44*68,80+p.z/44*68,p.id===selfId?4:3,0,Math.PI*2);ctx.fill();}}}
 const msg=document.querySelector("#game-message");if(msg)msg.textContent=current.message+" · "+voiceLabel;
 const gift=document.querySelector<HTMLButtonElement>("#gift");if(gift)gift.hidden=me.alive||me.patronPoints<1;const flare=document.querySelector<HTMLButtonElement>("#flare");if(flare)flare.textContent=current.phase==="helicopter"?"BOARD":"FLARE";
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
 figures.clear();drops.clear();snares.clear();keys.clear();
}
