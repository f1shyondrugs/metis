import {createHash} from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import {getAccountProfile} from "./account-profile";
import {avatarId,ownsAvatar,profileAvatarResponse} from "./profile-avatars";
import {canViewProjectMemberProfile} from "./project-access";
import {config} from "./config";
import {parseImageFraming,withImageFraming} from "./image-framing";
import type {NotebookPerson} from "./notebook-presence";

type User={id:string;username:string};
const colors=["#2563eb","#dc2626","#16a34a","#9333ea","#c2410c","#0891b2"];
const cache=new Map<string,Promise<string>>();
let running=0;const pending:Array<()=>void>=[];
async function bounded<T>(work:()=>Promise<T>):Promise<T>{
 if(running>=4)await new Promise<void>(resolve=>pending.push(resolve));
 else running++;
 try{return await work();}finally{const next=pending.shift();if(next)next();else running--;}
}
export function noteParticipantIdentity(user:User):NotebookPerson{
 const profile=getAccountProfile(user.id,user.username);
 const hash=[...user.id].reduce((value,char)=>(value*31+char.charCodeAt(0))>>>0,0);
 const version=profile.avatar?createHash("sha256").update(profile.avatar).digest("hex").slice(0,16):"";
 const avatar=profile.avatar?withImageFraming("/api/notes/presence/avatar/"+encodeURIComponent(user.id)+"?v="+version,parseImageFraming(profile.avatar).framing):null;
 return {id:user.id,username:user.username,name:(profile.displayName||user.username).slice(0,80),avatar,color:colors[hash%colors.length]};
}
export async function noteParticipant(user:User):Promise<NotebookPerson>{
 const person=noteParticipantIdentity(user),profile=getAccountProfile(user.id,user.username);
 if(!profile.avatar)return person;
 const key=person.avatar!;
 let color=cache.get(key);
 if(!color){
  if(cache.size>=256)cache.delete(cache.keys().next().value!);
  const original=profile.avatar;
  color=bounded(async()=>{
   try{
    const parsed=parseImageFraming(original),id=avatarId(original);
    const input=id&&ownsAvatar(user.id,original)?path.join(config.dataDir,"profile-avatars",id+".gif"):
      parsed.source.startsWith("data:image/png;base64,")?Buffer.from(parsed.source.split(",")[1],"base64"):null;
    if(!input)return person.color;
    const image=sharp(input,{animated:false,limitInputPixels:16_777_216});
    const meta=await image.metadata();
    const area=parsed.framing?.mode==="crop"?parsed.framing.area:null;
    if(area&&meta.width&&meta.height){
      const left=Math.min(meta.width-1,Math.round(area.x/100*meta.width)),top=Math.min(meta.height-1,Math.round(area.y/100*meta.height));
      image.extract({left,top,width:Math.max(1,Math.min(meta.width-left,Math.round(area.width/100*meta.width))),height:Math.max(1,Math.min(meta.height-top,Math.round(area.height/100*meta.height)))});
    }
    const sample=await image.resize(32,32,{fit:"inside"}).png().toBuffer();
    const {dominant}=await sharp(sample).stats();
    return "#"+[dominant.r,dominant.g,dominant.b].map(n=>n.toString(16).padStart(2,"0")).join("");
   }catch{return person.color;}
  });
  cache.set(key,color);
 }
 return {...person,color:await color};
}
export async function noteParticipantAvatar(subjectId:string,username:string,viewerId:string,ifNoneMatch?:string|null):Promise<Response>{
 const headers={"Cache-Control":"private, no-store","Vary":"Cookie","X-Content-Type-Options":"nosniff"};
 if(subjectId!==viewerId&&!canViewProjectMemberProfile(subjectId,viewerId))return new Response(null,{status:404,headers});
 const avatar=getAccountProfile(subjectId,username).avatar;
 if(!avatar)return new Response(null,{status:404,headers});
 const id=avatarId(avatar);
 if(id)return profileAvatarResponse(id,viewerId,ifNoneMatch);
 const source=parseImageFraming(avatar).source;
 if(!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(source))return new Response(null,{status:404,headers});
 const bytes=Buffer.from(source.split(",")[1],"base64"),etag='"'+createHash("sha256").update(avatar).digest("hex")+'"';
 const cacheHeaders={...headers,"Cache-Control":"private, no-cache",ETag:etag};
 if(ifNoneMatch?.split(",").some(value=>value.trim().replace(/^W\//,"")===etag))return new Response(null,{status:304,headers:cacheHeaders});
 return new Response(bytes,{headers:{...cacheHeaders,"Content-Type":"image/png","Content-Length":String(bytes.length)}});
}
