import { randomUUID } from "node:crypto";
import type { GameAction, GameInput, GamePlayer, GameState, InventoryStack, ItemId, LootDrop, Trap } from "@ashen-crown/shared";
import type { Room } from "./rooms.js";

const clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v));
const distance=(a:{x:number;z:number},b:{x:number;z:number})=>Math.hypot(a.x-b.x,a.z-b.z);
const items: ItemId[]=["spear","bow","arrows","axe","crossbow","bandage","splint","healthKit","waterBottle","ration","backpack","flareGun","torch","snare"];
const limits:Record<ItemId,number>={dagger:1,spear:1,bow:1,arrows:12,axe:1,crossbow:1,bandage:4,healthKit:2,waterBottle:3,ration:3,backpack:1,flareGun:1,torch:1,snare:2};

export class GameEngine {
  private states=new Map<string,GameState>();
  private inputs=new Map<string,GameInput>();
  private lastAction=new Map<string,number>();
  private invites=new Map<string,{fromId:string;toId:string}>();
  private friendlyFire=new Map<string,boolean>();
  start(room:Room,now=Date.now()) {
    const players:GamePlayer[]=[...room.players.values()].filter(p=>p.connected).map((p,i)=>{
      const a=i*Math.PI*2/Math.max(1,room.players.size);
      return {id:p.id,name:p.name,hearth:p.hearth,look:p.look,connected:true,x:Math.cos(a)*23,z:Math.sin(a)*23,yaw:a+Math.PI,health:100,hunger:100,thirst:100,stamina:100,alive:true,escaped:false,inventory:[{item:"dagger",count:1}],allianceId:null,bleeding:0,brokenLeg:false};
    });
    const loot:LootDrop[]=[];
    for(let i=0;i<48;i++){const a=i*2.399963,r=5+(i%8)*3;loot.push({id:randomUUID(),item:items[i%items.length],count:items[i%items.length]==="arrows"?6:1,x:Math.cos(a)*r,z:Math.sin(a)*r});}
    const length=room.settings.matchLengthMinutes*60_000;
    const collapseMultiplier=room.settings.collapseSpeed==="slow"?1.25:room.settings.collapseSpeed==="fast"?0.75:1;
    this.friendlyFire.set(room.code,room.settings.friendlyFire);
    this.states.set(room.code,{phase:"playing",startedAt:now,endsAt:now+length,players,loot,traps:[],allianceInvites:[],zone:{safeRadius:40,warningZone:null,collapseAt:null,collapsed:[],nextCollapseAt:now+Math.max(60_000,length/6*collapseMultiplier)},flare:null,helicopter:null,winnerId:null,message:"The Winnowing has begun. The Council is watching."});
  }
  get(code:string){return this.states.get(code);}
  setConnected(code:string,id:string,connected:boolean){const p=this.states.get(code)?.players.find(x=>x.id===id);if(p)p.connected=connected;}
  input(code:string,id:string,input:GameInput){const s=this.states.get(code),p=s?.players.find(x=>x.id===id&&x.alive);if(!p)return;this.inputs.set(code+":"+id,{x:clamp(input.x,-1,1),z:clamp(input.z,-1,1),yaw:input.yaw,sprint:!!input.sprint});}
  action(code:string,id:string,action:GameAction,now=Date.now()){
    const s=this.states.get(code),p=s?.players.find(x=>x.id===id&&x.alive);if(!s||!p||s.phase==="ended")return;
    const key=code+":"+id, last=this.lastAction.get(key)??0;if(now-last<220)return;this.lastAction.set(key,now);
    if(action.type==="attack"){const t=s.players.find(x=>x.id===action.targetId&&x.alive);const ranged=p.inventory.some(x=>x.item==="bow"||x.item==="crossbow")&&p.inventory.some(x=>x.item==="arrows"&&x.count>0);const range=ranged?24:2.5;if(!t||t.id===p.id||distance(p,t)>range||p.stamina<8)return;if(!this.friendlyFire.get(code)&&p.allianceId&&p.allianceId===t.allianceId)return;p.stamina-=8;if(ranged){const arrows=p.inventory.find(x=>x.item==="arrows")!;arrows.count--;if(!arrows.count)p.inventory=p.inventory.filter(x=>x!==arrows);}const damage=ranged?(p.inventory.some(x=>x.item==="crossbow")?34:26):(p.inventory.some(x=>x.item==="axe")?35:p.inventory.some(x=>x.item==="spear")?32:22);t.health-=damage;if(t.health<=0){t.health=0;t.alive=false;for(const stack of t.inventory)if(stack.item!=="dagger")s.loot.push({id:randomUUID(),item:stack.item,count:stack.count,x:t.x,z:t.z});t.inventory=t.inventory.filter(x=>x.item==="dagger");s.message=t.name+" has fallen."; }}
    if(action.type==="loot"){const d=s.loot.find(x=>x.id===action.dropId);if(!d||distance(p,d)>2.8)return;const existing=p.inventory.find(x=>x.item===d.item);const cap=p.inventory.some(x=>x.item==="backpack")?12:8;if(existing&&existing.count<limits[d.item])existing.count=Math.min(limits[d.item],existing.count+d.count);else if(p.inventory.length<cap)p.inventory.push({item:d.item,count:d.count});else return;s.loot=s.loot.filter(x=>x.id!==d.id);}
    if(action.type==="use"){const stack=p.inventory[action.slot];if(!stack)return;if(stack.item==="snare"){s.traps.push({id:randomUUID(),ownerId:p.id,x:p.x,z:p.z});stack.count--;if(!stack.count)p.inventory.splice(action.slot,1);return;}const effect:Partial<Record<ItemId,()=>void>>={bandage:()=>{p.health=Math.min(100,p.health+18);p.bleeding=0;},splint:()=>{p.brokenLeg=false;},healthKit:()=>{p.health=Math.min(100,p.health+55);p.bleeding=0;},waterBottle:()=>{p.thirst=Math.min(100,p.thirst+45);},ration:()=>{p.hunger=Math.min(100,p.hunger+45);}};if(!effect[stack.item])return;effect[stack.item]!();stack.count--;if(!stack.count)p.inventory.splice(action.slot,1);}
    if(action.type==="drop"){const stack=p.inventory[action.slot];if(!stack||stack.item==="dagger")return;s.loot.push({id:randomUUID(),item:stack.item,count:stack.count,x:p.x,z:p.z});p.inventory.splice(action.slot,1);}
    if(action.type==="flare"&&p.inventory.some(x=>x.item==="flareGun")&&!s.flare){s.phase="flare";s.flare={x:p.x,z:p.z,shooterId:p.id,helicopterAt:now+60_000};s.message="A flare burns above the forest. Your position is revealed.";}
    if(action.type==="ally-invite"){const t=s.players.find(x=>x.id===action.targetId&&x.alive);if(!t||t.id===p.id||distance(p,t)>5||t.allianceId)return;const groupSize=p.allianceId?s.players.filter(x=>x.allianceId===p.allianceId).length:1;if(groupSize>=3)return;this.invites.set(code+":"+t.id,{fromId:p.id,toId:t.id});if(!s.allianceInvites.some(x=>x.toId===t.id))s.allianceInvites.push({fromId:p.id,toId:t.id});s.message=p.name+" offered an alliance to "+t.name+"."; }
    if(action.type==="ally-respond"){const inv=this.invites.get(code+":"+p.id);if(!inv||inv.fromId!==action.fromId)return;this.invites.delete(code+":"+p.id);s.allianceInvites=s.allianceInvites.filter(x=>x.toId!==p.id);const other=s.players.find(x=>x.id===inv.fromId);if(action.accept&&other?.alive&&!p.allianceId&&(!other.allianceId||s.players.filter(x=>x.allianceId===other.allianceId).length<3)){const alliance=other.allianceId??randomUUID();other.allianceId=alliance;p.allianceId=alliance;s.message=other.name+" and "+p.name+" have formed an alliance."; }}
    if(action.type==="leave-alliance"){const id=p.allianceId;if(id){for(const member of s.players)if(member.allianceId===id)member.allianceId=null;s.message=p.name+" has left their alliance.";}}
    if(action.type==="board-helicopter"&&s.phase==="helicopter"&&s.helicopter&&distance(p,s.helicopter)<6){const escaped=s.players.filter(x=>x.escaped).length;if(escaped<2){p.escaped=true;s.message=p.name+" has boarded the helicopter.";}}
    if(action.type==="emote"){const allowed=["Enemy spotted","Need supplies","Come here","Danger","I'm moving"];if(allowed.includes(action.text))s.message=p.name+": "+action.text;}
  }
  tick(room:Room,now=Date.now()){
    const s=this.states.get(room.code);if(!s||s.phase==="ended")return;
    const dt=0.05;
    for(const p of s.players){if(!room.players.has(p.id)){p.alive=false;continue;}if(!p.alive||p.escaped)continue;const input=p.connected?(this.inputs.get(room.code+":"+p.id)??{x:0,z:0,yaw:p.yaw,sprint:false}):{x:0,z:0,yaw:p.yaw,sprint:false};if(p.connected)p.yaw=input.yaw;const mag=Math.hypot(input.x,input.z)||1;const speed=input.sprint&&p.stamina>0&&!p.brokenLeg?8.2:p.brokenLeg?3.2:5.1;p.x=clamp(p.x+input.x/mag*speed*dt,-43,43);p.z=clamp(p.z+input.z/mag*speed*dt,-43,43);p.stamina=clamp(p.stamina+(input.sprint?-18:12)*dt,0,100);p.hunger=clamp(p.hunger-0.025*dt,0,100);p.thirst=clamp(p.thirst-0.04*dt,0,100);if(p.hunger===0||p.thirst===0)p.health-=0.15;if(p.bleeding>0){p.health-=p.bleeding*dt;p.bleeding=Math.max(0,p.bleeding-0.01*dt);}if(Math.hypot(p.x,p.z)>s.zone.safeRadius){p.health-=5*dt;}for(const trap of s.traps){if(trap.ownerId!==p.id&&distance(p,trap)<1.4){p.health-=30;p.bleeding=0.5;p.brokenLeg=true;s.traps=s.traps.filter(x=>x.id!==trap.id);s.message=p.name+" was caught in a snare.";break;}}if(p.health<=0){p.health=0;p.alive=false;for(const stack of p.inventory)if(stack.item!=="dagger")s.loot.push({id:randomUUID(),item:stack.item,count:stack.count,x:p.x,z:p.z});p.inventory=p.inventory.filter(x=>x.item==="dagger");s.message=p.name+" has fallen."; }}
    if(s.zone.warningZone===null&&now>=s.zone.nextCollapseAt&&s.zone.collapsed.length<5){s.zone.warningZone=s.zone.collapsed.length;s.zone.collapseAt=now+60_000;s.message=["Marsh","Cinder Flats","Pine Forest","Salt Dunes","Frost Ridge","Orchard Ruins"][s.zone.warningZone]+" will collapse in sixty seconds. Move to safety.";}
    if(s.zone.warningZone!==null&&s.zone.collapseAt!==null&&now>=s.zone.collapseAt){s.zone.collapsed.push(s.zone.warningZone);s.zone.warningZone=null;s.zone.collapseAt=null;s.zone.safeRadius=Math.max(8,s.zone.safeRadius-6);s.zone.nextCollapseAt=now+Math.max(45_000,(room.settings.matchLengthMinutes*60_000)/6*collapseMultiplier);s.message="The toxic boundary advances."; }
    if(s.phase==="flare"&&s.flare&&now>=s.flare.helicopterAt){s.phase="helicopter";s.helicopter={x:s.flare.x,z:s.flare.z,leavesAt:now+30_000};s.message="The helicopter has arrived. Two seats remain.";}
    if(s.phase==="helicopter"&&s.helicopter&&now>=s.helicopter.leavesAt){s.phase="ended";const escaped=s.players.filter(p=>p.escaped);s.winnerId=escaped[0]?.id??null;s.message="The helicopter has departed. "+escaped.length+" Kindled escaped."; }
    const alive=s.players.filter(p=>p.alive&&!p.escaped);if(alive.length===0&&s.phase!=="ended"&&s.phase!=="helicopter"){s.phase="ended";s.winnerId=null;s.message="No Kindled survived the Winnowing.";}if(alive.length===1&&s.phase!=="ended"&&s.phase!=="helicopter"){s.phase="ended";s.winnerId=alive[0].id;s.message=alive[0].name+" is the last Kindled standing.";}if(now>=s.endsAt&&s.phase!=="ended"){s.phase="ended";s.winnerId=alive[0]?.id??null;s.message="The Winnowing has ended.";}
  }
  snapshot(code:string):GameState|undefined{const s=this.states.get(code);return s?structuredClone(s):undefined;}
}
