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
let stickX=0,stickY=0,cameraYaw=0,cameraPitch=0.28,cameraDistance=13,draggingCamera=false,lastPointerX=0,lastPointerY=0;
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
  root.innerHTML=`<div id="game" class="game-screen"><div class="game-top"><div><span class="game-kicker">THE REGENT COUNCIL PRESENTS</span><strong>ASHEN CROWN</strong></div><div id="game-message">Quillwood is watching.</div><canvas id="minimap" width="160" height="160" aria-label="Arena minimap"></canvas></div><div class="game-bottom"><div class="stat-panel" id="stats"></div><div class="inventory-panel" id="inventory"></div><div class="game-actions"><button id="attack">STRIKE</button><button id="loot">LOOT</button><button id="flare">FLARE</button><button id="ally">ALLY</button><button id="voice">VOICE</button><button id="ping">PING</button><button id="gift">GIFT</button></div></div><div class="mobile-controls"><div class="move-zone"><div id="stick-base"><div id="stick-knob"></div></div><span>MOVE</span></div><div class="action-cluster"><button id="mobile-dodge" class="round-action">DODGE</button><button id="mobile-attack" class="round-action primary-action">⚔</button><button id="mobile-block" class="round-action">BLOCK</button><button id="mobile-run" class="round-action">RUN</button></div><div class="camera-hint">DRAG TO LOOK</div></div><div id="game-result" class="game-result" hidden></div></div>`;
  scene=new THREE.Scene();
  scene.background=new THREE.Color("#a9b5aa");scene.fog=new THREE.FogExp2("#a9b5aa",.0028);
  camera=new THREE.PerspectiveCamera(52,innerWidth/innerHeight,.1,520);
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:"high-performance"});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.65));renderer.setSize(innerWidth,innerHeight);
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;
  renderer.domElement.className="game-canvas";document.querySelector("#game")!.prepend(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xdce8e2,0x354438,1.65));
  const sun=new THREE.DirectionalLight(0xffe5bd,3.1);sun.position.set(-48,72,28);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-110;sun.shadow.camera.right=110;sun.shadow.camera.top=110;sun.shadow.camera.bottom=-110;sun.shadow.bias=-.00025;scene.add(sun);
  const fill=new THREE.DirectionalLight(0x9bb9d2,.8);fill.position.set(45,24,-48);scene.add(fill);
  const mat=(c:string,r=1,m=0)=>new THREE.MeshStandardMaterial({color:c,roughness:r,metalness:m});
  const hex=new THREE.Mesh(new THREE.CylinderGeometry(92,96,3,6),mat("#4e5746"));hex.position.y=-1.55;hex.rotation.y=Math.PI/6;hex.receiveShadow=true;scene.add(hex);
  const soil=new THREE.Mesh(new THREE.CircleGeometry(90,128),mat("#6f7658"));soil.rotation.x=-Math.PI/2;soil.position.y=-.02;soil.receiveShadow=true;scene.add(soil);
  const biome=["#718a68","#9c6549","#345d4b","#bcae85","#91acb7","#986c66"];
  const biomeMats=biome.map(c=>mat(c));
  for(let i=0;i<6;i++){
    const a0=i*Math.PI/3-Math.PI/6,shape=new THREE.Shape();shape.moveTo(0,0);shape.lineTo(Math.cos(a0)*89,Math.sin(a0)*89);
    for(let j=1;j<=48;j++){const a=a0+Math.PI/3*j/48;shape.lineTo(Math.cos(a)*89,Math.sin(a)*89);}shape.lineTo(0,0);
    const sector=new THREE.Mesh(new THREE.ShapeGeometry(shape),new THREE.MeshStandardMaterial({color:biome[i],roughness:.96,transparent:true,opacity:.34,side:THREE.DoubleSide}));sector.rotation.x=-Math.PI/2;sector.position.y=.025;sector.receiveShadow=true;scene.add(sector);
    const road=new THREE.Mesh(new THREE.BoxGeometry(6,.18,70),mat("#b6a27a"));road.position.set(Math.cos(i*Math.PI/3)*36,.12,Math.sin(i*Math.PI/3)*36);road.rotation.y=-i*Math.PI/3;road.receiveShadow=true;scene.add(road);
    // A landmark, shrine, and distinctive foliage anchor each region.
    const shrine=new THREE.Group();const plinth=new THREE.Mesh(new THREE.CylinderGeometry(3.4,4.3,1.8,8),mat("#625f50"));plinth.position.y=.9;plinth.castShadow=true;shrine.add(plinth);
    const obelisk=new THREE.Mesh(new THREE.OctahedronGeometry(2.2,0),new THREE.MeshStandardMaterial({color:biome[i],roughness:.35,metalness:.18,emissive:biome[i],emissiveIntensity:.08}));obelisk.scale.set(.75,1.7,.75);obelisk.position.y=3.6;obelisk.castShadow=true;shrine.add(obelisk);
    shrine.position.set(Math.cos(i*Math.PI/3)*76,0,Math.sin(i*Math.PI/3)*76);scene.add(shrine);
    for(let j=0;j<22;j++){
      const a=i*Math.PI/3+(j-10.5)*.075,r=43+(j%6)*5.5,x=Math.cos(a)*r,z=Math.sin(a)*r;
      const tree=new THREE.Group();const trunk=new THREE.Mesh(new THREE.CylinderGeometry(.22,.42,2.6,7),mat("#594838"));trunk.position.y=1.3;trunk.castShadow=true;tree.add(trunk);
      if(i===2||i===5){
        for(let k=0;k<3;k++){const crown=new THREE.Mesh(new THREE.IcosahedronGeometry(1.7-k*.22,1),mat(i===2?(k%2?"#416d50":"#315a43"):(k%2?"#9a7868":"#765a56")));crown.position.set((k-1)*.48,2.8+k*.65,0);crown.scale.set(1,1.1,1);crown.castShadow=true;tree.add(crown);}
      }else{
        const crown=new THREE.Mesh(new THREE.ConeGeometry(i===4?2.1:1.8,4.8,7),mat(i===0?"#82996a":i===1?"#b06c4d":i===3?"#c9b98e":"#91aeb8"));crown.position.y=3.8;crown.castShadow=true;tree.add(crown);
      }
      tree.position.set(x,0,z);tree.rotation.y=j*1.7;tree.scale.setScalar(.8+(j%4)*.12);scene.add(tree);
      if(j%3===0){const boulder=new THREE.Mesh(new THREE.DodecahedronGeometry(1.1+(j%3)*.35,0),mat("#686b5d"));boulder.position.set(x+2,.5,z-2);boulder.scale.y=.7;boulder.rotation.set(j,j*.7,0);boulder.castShadow=true;scene.add(boulder);}
    }
  }
  // Layered central citadel: steps, paving, banners and a warm beacon.
  const camp=new THREE.Group();const base=new THREE.Mesh(new THREE.CylinderGeometry(13,15,2.2,8),mat("#b6a078"));base.position.y=.8;base.castShadow=true;base.receiveShadow=true;camp.add(base);
  const inner=new THREE.Mesh(new THREE.CylinderGeometry(8.5,9.5,.7,8),mat("#d3bd8b"));inner.position.y=2.2;camp.add(inner);
  const fire=new THREE.Mesh(new THREE.ConeGeometry(1.35,4.8,9),new THREE.MeshStandardMaterial({color:"#ff9b48",emissive:"#d95b1d",emissiveIntensity:1.4,roughness:.35}));fire.position.y=4.7;camp.add(fire);
  const flameLight=new THREE.PointLight(0xff9a51,28,35);flameLight.position.y=5;camp.add(flameLight);camp.position.set(0,0,0);scene.add(camp);
  for(let i=0;i<8;i++){const a=i*Math.PI/4;const pillar=new THREE.Mesh(new THREE.BoxGeometry(.8,4.4,.8),mat("#706b58"));pillar.position.set(Math.cos(a)*11,2.2,Math.sin(a)*11);pillar.castShadow=true;scene.add(pillar);}
  const water=new THREE.Mesh(new THREE.TorusGeometry(98,5,12,220),new THREE.MeshStandardMaterial({color:"#355d66",roughness:.28,metalness:.18,transparent:true,opacity:.92}));water.rotation.x=Math.PI/2;water.position.y=-.9;scene.add(water);
  const ring=new THREE.Mesh(new THREE.TorusGeometry(88,.24,10,220),new THREE.MeshBasicMaterial({color:"#f3d99a"}));ring.rotation.x=Math.PI/2;ring.position.y=.28;ring.name="safe-ring";scene.add(ring);
  // Terrain dressing: fern clusters, fallen logs, and stone paths create foreground depth.
  for(let i=0;i<140;i++){const a=i*2.399963,r=19+(i*53%6700)/100;if(r>86)continue;const x=Math.cos(a)*r,z=Math.sin(a)*r;
    const rock=new THREE.Mesh(new THREE.DodecahedronGeometry(.35+(i%5)*.18,0),mat(i%4===0?"#8c8068":"#555f50"));rock.position.set(x,.22,z);rock.rotation.set(i*.4,i*.7,i*.2);rock.scale.y=.55;rock.castShadow=true;scene.add(rock);
    if(i%4===0){const fern=new THREE.Group();for(let k=0;k<5;k++){const leaf=new THREE.Mesh(new THREE.ConeGeometry(.16,1.45,5),mat("#4e754c"));leaf.position.set(Math.cos(k*1.256)*.45,.65,Math.sin(k*1.256)*.45);leaf.rotation.z=-.45;fern.add(leaf);}fern.position.set(x+1,.1,z-.8);scene.add(fern);}
  }
  const resize=()=>{if(!camera||!renderer)return;camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);};window.addEventListener("resize",resize);
  window.addEventListener("keydown",e=>{const k=e.key.toLowerCase();if(["w","a","s","d","arrowup","arrowdown","arrowleft","arrowright","shift","q"," "].includes(k)){keys.add(k);e.preventDefault();}});
  renderer.domElement.addEventListener("pointerdown",e=>{draggingCamera=true;lastPointerX=e.clientX;lastPointerY=e.clientY;renderer?.domElement.setPointerCapture(e.pointerId);});
  renderer.domElement.addEventListener("pointermove",e=>{if(!draggingCamera)return;cameraYaw-=(e.clientX-lastPointerX)*.006;cameraPitch=Math.max(.12,Math.min(.62,cameraPitch+(e.clientY-lastPointerY)*.003));lastPointerX=e.clientX;lastPointerY=e.clientY;});
  renderer.domElement.addEventListener("pointerup",()=>draggingCamera=false);renderer.domElement.addEventListener("pointercancel",()=>draggingCamera=false);
  const stick=document.querySelector<HTMLElement>("#stick-base"),knob=document.querySelector<HTMLElement>("#stick-knob");
  stick?.addEventListener("pointerdown",e=>{e.preventDefault();stick.setPointerCapture(e.pointerId);moveStick(e);});
  stick?.addEventListener("pointermove",e=>{if(e.buttons)moveStick(e);});
  for(const ev of ["pointerup","pointercancel","lostpointercapture"])stick?.addEventListener(ev,()=>{stickX=0;stickY=0;if(knob)knob.style.transform="translate(0,0)";});
  function moveStick(e:PointerEvent){const r=stick!.getBoundingClientRect(),dx=e.clientX-(r.left+r.width/2),dy=e.clientY-(r.top+r.height/2),len=Math.max(1,Math.hypot(dx,dy)),scale=Math.min(1,len/42);stickX=dx/len*scale;stickY=dy/len*scale;if(knob)knob.style.transform=`translate(${stickX*42}px,${stickY*42}px)`;}
  document.querySelector("#mobile-attack")?.addEventListener("click",attack);document.querySelector("#mobile-dodge")?.addEventListener("pointerdown",()=>keys.add(" "));document.querySelector("#mobile-dodge")?.addEventListener("pointerup",()=>keys.delete(" "));
  document.querySelector("#mobile-block")?.addEventListener("pointerdown",()=>keys.add("q"));document.querySelector("#mobile-block")?.addEventListener("pointerup",()=>keys.delete("q"));
  document.querySelector("#mobile-run")?.addEventListener("pointerdown",()=>keys.add("shift"));document.querySelector("#mobile-run")?.addEventListener("pointerup",()=>keys.delete("shift"));
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
  renderer.setAnimationLoop(()=>{if(!renderer||!scene||!camera||!current)return;const me=current.players.find(p=>p.id===selfId);const target=me?.alive?me:current.players.filter(p=>p.alive&&!p.escaped).sort((a,b)=>dist(a,me??a)-dist(b,me??a))[0];if(target){const horizontal=Math.cos(cameraPitch)*cameraDistance;const desired=new THREE.Vector3(target.x*2+Math.sin(cameraYaw)*horizontal,3+Math.sin(cameraPitch)*cameraDistance,target.z*2+Math.cos(cameraYaw)*horizontal);camera.position.lerp(desired,.16);camera.lookAt(target.x*2,1.25,target.z*2);}renderer.render(scene,camera);});
}
function sendInput(){if(!current)return;const x=stickX+(keys.has("d")||keys.has("arrowright")?1:0)-(keys.has("a")||keys.has("arrowleft")?1:0),z=stickY+(keys.has("s")||keys.has("arrowdown")?1:0)-(keys.has("w")||keys.has("arrowup")?1:0);const forward=Math.cos(cameraYaw),right=Math.sin(cameraYaw),worldX=x*forward+z*right,worldZ=z*forward-x*right;const now=performance.now();if(now-lastInput<45)return;lastInput=now;sendMessage({type:"game-input",input:{x:worldX,z:worldZ,yaw:Math.atan2(worldX,worldZ),sprint:keys.has("shift"),block:keys.has("q"),dodge:keys.has(" ")}});}
function attack(){const me=current?.players.find(p=>p.id===selfId);const target=current?.players.filter(p=>p.alive&&p.id!==selfId).sort((a,b)=>dist(a,me??a)-dist(b,me??b))[0];if(target)sendMessage({type:"game-action",action:{type:"attack",targetId:target.id}});}
function loot(){const me=current?.players.find(p=>p.id===selfId);const d=current?.loot.slice().sort((a,b)=>dist(a,me??a)-dist(b,me??b))[0];if(d)sendMessage({type:"game-action",action:{type:"loot",dropId:d.id}});}
function invite(){const me=current?.players.find(p=>p.id===selfId);const target=current?.players.filter(p=>p.alive&&p.id!==selfId).sort((a,b)=>dist(a,me??a)-dist(b,me??b))[0];if(target)sendMessage({type:"game-action",action:{type:"ally-invite",targetId:target.id}});}
function updateScene(){
 if(!scene||!current)return;
 for(const p of current.players){let mesh=figures.get(p.id);if(!mesh){
  mesh=new THREE.Group();
  const paper=new THREE.MeshStandardMaterial({color:color[p.hearth]??"#777",roughness:.88,flatShading:true});
  const trim=new THREE.MeshStandardMaterial({color:"#d8c79b",roughness:.82,flatShading:true});
  const leather=new THREE.MeshStandardMaterial({color:"#514537",roughness:.96,flatShading:true});
  const skin=new THREE.MeshStandardMaterial({color:"#d5b895",roughness:.9,flatShading:true});
  const dark=new THREE.MeshStandardMaterial({color:"#282d28",roughness:.8});
  const torso=new THREE.Mesh(new THREE.CylinderGeometry(.31,.43,.92,7),paper);torso.position.y=1.02;torso.castShadow=true;
  const chest=new THREE.Mesh(new THREE.BoxGeometry(.62,.36,.18),paper);chest.position.set(0,1.2,.03);chest.rotation.x=-.12;
  const collar=new THREE.Mesh(new THREE.TorusGeometry(.27,.055,5,8),trim);collar.position.y=1.48;collar.rotation.x=Math.PI/2;
  const belt=new THREE.Mesh(new THREE.CylinderGeometry(.36,.36,.11,8),leather);belt.position.y=.76;
  const buckle=new THREE.Mesh(new THREE.BoxGeometry(.13,.13,.04),trim);buckle.position.set(0,.77,.36);
  const head=new THREE.Mesh(new THREE.IcosahedronGeometry(.31,1),skin);head.position.y=1.72;head.scale.set(.88,1.05,.9);head.castShadow=true;
  const hood=new THREE.Mesh(new THREE.SphereGeometry(.325,8,6,0,Math.PI*2,0,Math.PI*.58),leather);hood.position.set(0,1.81,-.035);
  const face=new THREE.Mesh(new THREE.BoxGeometry(.28,.08,.045),skin);face.position.set(0,1.62,.26);
  const eyeL=new THREE.Mesh(new THREE.SphereGeometry(.025,6,5),dark);eyeL.position.set(-.085,1.72,.278);
  const eyeR=eyeL.clone();eyeR.position.x=.085;
  const scarf=new THREE.Mesh(new THREE.ConeGeometry(.2,.48,5),trim);scarf.position.set(0,1.25,.2);scarf.rotation.x=-.8;
  const armL=new THREE.Group(),armR=new THREE.Group();
  for(const [arm,side] of [[armL,-1],[armR,1]] as const){
    const upper=new THREE.Mesh(new THREE.CylinderGeometry(.105,.13,.43,6),paper);upper.position.y=-.19;upper.castShadow=true;
    const cuff=new THREE.Mesh(new THREE.CylinderGeometry(.105,.105,.1,6),trim);cuff.position.y=-.4;
    const hand=new THREE.Mesh(new THREE.IcosahedronGeometry(.105,0),skin);hand.position.y=-.51;
    arm.add(upper,cuff,hand);arm.position.set(side*.43,1.25,0);arm.rotation.z=side*.12;
  }
  const legL=new THREE.Group(),legR=new THREE.Group();
  for(const [leg,side] of [[legL,-1],[legR,1]] as const){
    const thigh=new THREE.Mesh(new THREE.CylinderGeometry(.13,.15,.43,6),leather);thigh.position.y=-.18;thigh.castShadow=true;
    const boot=new THREE.Mesh(new THREE.BoxGeometry(.24,.2,.38),dark);boot.position.set(0,-.45,.07);boot.castShadow=true;
    leg.add(thigh,boot);leg.position.set(side*.19,.58,0);
  }
  const pack=new THREE.Mesh(new THREE.BoxGeometry(.46,.56,.25),leather);pack.position.set(0,1.08,-.3);pack.castShadow=true;
  const packFlap=new THREE.Mesh(new THREE.BoxGeometry(.34,.2,.04),trim);packFlap.position.set(0,1.25,-.44);
  const shoulderCape=new THREE.Mesh(new THREE.ConeGeometry(.58,.78,5),paper);shoulderCape.position.set(0,1.02,-.22);shoulderCape.rotation.x=Math.PI;
  const badge=new THREE.Mesh(new THREE.OctahedronGeometry(.105,0),trim);badge.position.set(.23,1.31,.16);
  mesh.add(torso,chest,collar,belt,buckle,head,hood,face,eyeL,eyeR,scarf,armL,armR,legL,legR,pack,packFlap,shoulderCape,badge);
  mesh.traverse(o=>{if((o as THREE.Mesh).isMesh){(o as THREE.Mesh).castShadow=true;(o as THREE.Mesh).receiveShadow=true;}});
  scene.add(mesh);figures.set(p.id,mesh);
 }mesh.position.set(p.x*2,0,p.z*2);mesh.scale.setScalar(1.35);mesh.rotation.y=p.yaw;mesh.visible=p.alive&&!p.escaped;}
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
