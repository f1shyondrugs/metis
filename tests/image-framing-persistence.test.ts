import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { parseImageFraming, withImageFraming } from "../lib/image-framing";

const root=mkdtempSync(path.join(tmpdir(),"metis-image-framing-"));
Object.assign(process.env,{CHAT_DATA_DIR:root,CHAT_DB_PATH:path.join(root,"test.sqlite"),AI_CHAT_ROOT:root,AGENT_CWD:root,AI_CHAT_PUBLIC_URL:"http://localhost"});
after(async()=>{const {getDatabase}=await import("../lib/sqlite");getDatabase().close();rmSync(root,{recursive:true,force:true});});
const fit={mode:"fit" as const};
const crop={mode:"crop" as const,area:{x:20,y:10,width:40,height:80}};
async function user(name:string) {const {createUser}=await import("../lib/auth");return createUser(name,"fixture-password-123");}

test("PNG profile framing round-trips without cropping source dimensions, including legacy profile clients",async()=>{
 const owner=await user("framing-png"),{saveAccountProfile,getAccountProfile}=await import("../lib/account-profile");
 const png=await sharp({create:{width:160,height:80,channels:4,background:"#32aaff"}}).png().toBuffer();
 const source="data:image/png;base64,"+png.toString("base64");
 for(const framing of [fit,crop]) {
   const avatar=withImageFraming(source,framing);
   saveAccountProfile(owner.id,{displayName:"Test",bio:"",avatar,links:[],sharing:false,shareActivity:false});
   assert.equal(getAccountProfile(owner.id,owner.username).avatar,avatar);
   const dimensions=await sharp(Buffer.from(parseImageFraming(avatar).source.split(",")[1],"base64")).metadata();
   assert.equal(dimensions.width,160);assert.equal(dimensions.height,80);
 }
 assert.throws(()=>saveAccountProfile(owner.id,{displayName:"Test",bio:"",avatar:source+"#metis-image=crop,0,0,0,100",links:[],sharing:false,shareActivity:false}));
 saveAccountProfile(owner.id,{displayName:"Test",bio:"",avatar:source,links:[],sharing:false,shareActivity:false});
 assert.equal(getAccountProfile(owner.id,owner.username).avatar,source);
});

test("framed GIF ownership, public access, revocation and cleanup use the original immutable file",async()=>{
 const owner=await user("framing-gif"),other=await user("framing-foreign");
 const {uploadProfileGif,profileAvatarResponse}=await import("../lib/profile-avatars");
 const {saveAccountProfile}=await import("../lib/account-profile");
 const bytes=Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7","base64");
 const source=await uploadProfileGif(owner.id,new Request("http://localhost",{method:"PUT",headers:{"content-type":"image/gif"},body:new Uint8Array(bytes)}));
 const avatar=withImageFraming(source,fit),id=source.split("/").at(-1)!;
 const base={displayName:"Test",bio:"",links:[],sharing:true,shareActivity:false};
 assert.throws(()=>saveAccountProfile(other.id,{...base,avatar}));
 saveAccountProfile(owner.id,{...base,avatar});
 assert.deepEqual(Buffer.from(await profileAvatarResponse(id).arrayBuffer()),bytes);
 saveAccountProfile(owner.id,{...base,avatar:withImageFraming(source,crop)});
 assert.equal(profileAvatarResponse(id).status,200);
 saveAccountProfile(owner.id,{...base,avatar,sharing:false});
 assert.equal(profileAvatarResponse(id).status,404);
 assert.equal(profileAvatarResponse(id,owner.id).status,200);
 saveAccountProfile(owner.id,{...base,avatar:null,sharing:false});
 assert.equal(profileAvatarResponse(id,owner.id).status,404);
});

test("note cover framing persists, is projected into shared assets and never grants another page's files",async()=>{
 const owner=await user("framing-note");
 const notes=await import("../lib/shared-context"),files=await import("../lib/note-attachments"),shares=await import("../lib/note-sharing");
 const page=notes.createNote({ownerId:owner.id,title:"Framed banner"});
 const png=await sharp({create:{width:80,height:40,channels:4,background:"#32aaff"}}).png().toBuffer();
 const [attachment]=await files.storeNoteFiles(page.id,[new File([new Uint8Array(png)],"banner.png",{type:"image/png"})],owner.id);
 const bannerCrop={...crop,bannerStyle:"fade" as const};
 const cover=withImageFraming(attachment.url,bannerCrop);
 notes.updateNote(page.id,{ownerId:owner.id,cover});
 assert.equal(notes.getNote(page.id,owner.id)?.cover,cover);
 const share=shares.createNoteShare(page.id,owner.id),publicPage=shares.getSharedNote(share.token)!;
 assert.equal(Object.getPrototypeOf(publicPage.assets),Object.prototype,"Public assets must be serializable by React Server Components");
 const projected=publicPage.notes.find(note=>note.id===page.id)!.cover!;
 assert.deepEqual(parseImageFraming(projected).framing,bannerCrop);
 assert.equal(publicPage.assets[cover],projected);
 const asset=await shares.getSharedNoteAsset(share.token,cover,new Request("http://localhost"));
 assert.equal(asset?.status,200);assert.deepEqual(Buffer.from(await asset!.arrayBuffer()),png);
 const archive=await import("../lib/note-archive");
 const exported=await archive.exportNoteArchive({ownerId:owner.id,rootId:page.id});
 const imported=await archive.importNoteArchive({ownerId:owner.id,file:new File([new Uint8Array(exported)],"framed.zip",{type:"application/zip"})});
 const importedPage=imported.notes.find(note=>note.title==="Framed banner")!;
 assert.ok(importedPage);
 const importedCover=parseImageFraming(importedPage.cover!);
 assert.deepEqual(importedCover.framing,bannerCrop);
 assert.ok(importedCover.source.startsWith("/api/notes/"+importedPage.id+"/attachments/"));
 const importedId=importedCover.source.split("/").at(-1)!;
 const importedAsset=await files.readNoteFile(importedPage.id,importedId,owner.id);
 assert.ok(importedAsset);
 const privatePage=notes.createNote({ownerId:owner.id,title:"Unshared"});
 const [foreign]=await files.storeNoteFiles(privatePage.id,[new File([new Uint8Array(png)],"private.png",{type:"image/png"})],owner.id);
 notes.updateNote(page.id,{ownerId:owner.id,cover:withImageFraming(foreign.url,fit)});
 assert.equal(shares.getSharedNote(share.token)!.notes.find(note=>note.id===page.id)!.cover,undefined);
});
