import assert from "node:assert/strict";
import test,{after} from "node:test";
import {mkdtempSync,rmSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {productName} from "../lib/product-name";
const root=mkdtempSync(path.join(os.tmpdir(),"metis-chat-trash-"));
Object.assign(process.env,{AI_CHAT_ROOT:root,CHAT_DATA_DIR:root,CHAT_DB_PATH:path.join(root,"chat.sqlite"),AGENT_CWD:root,CHAT_PASSWORD:"",METIS_AI_BOOTSTRAP_PASSWORD:""});
const modules=Promise.all([import("../lib/auth"),import("../lib/db-store"),import("../lib/chat-trash"),import("../lib/sqlite")]);
after(async()=>{(await modules)[3].getDatabase().close();rmSync(root,{recursive:true,force:true});});
let sequence=0;
async function user(){const [auth]=await modules;const name="trash-user-"+(++sequence);const value=auth.createUser(name,"fixture-password");return {...value,token:auth.authenticateUser(name,"fixture-password")!.token};}
function request(method:string,token?:string,body?:unknown,origin?:string){return new Request("http://localhost/api/chats/deleted",{method,headers:{...(token?{cookie:"ai_chat_auth="+token}:{}),...(origin?{origin}:{}),"content-type":"application/json"},...(body!==undefined?{body:JSON.stringify(body)}:{})});}

test("normal delete moves complete transcript and workspaces out of live reads, restores once with shares revoked",async()=>{
 const [,store,trash,sqlite]=await modules, owner=await user(),other=await user();
 const created=store.createChat("Keep this conversation",undefined,owner.id);
 store.appendMessage(created.id,{role:"user",content:"A complete message"},owner.id);
 store.updateChat(created.id,{workspaces:[{id:"canvas-a",type:"canvas",name:"Draft",content:"# Exact saved content",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}]},owner.id);
 store.updateChatShare(created.id,{active:true},owner.id);
 const before=store.getChat(created.id,owner.id)!;
 sqlite.getDatabase().prepare("INSERT INTO chat_user_settings VALUES(?,?,?)").run(created.id,owner.id,JSON.stringify({modelId:"saved-model",modelParams:[]}));
 assert.equal(trash.moveChatToTrash(created.id,other.id),false);
 assert.equal(trash.moveChatToTrash(created.id,owner.id),true);
 assert.equal(store.getChat(created.id,owner.id),null);
 assert.ok(!store.listChatsForUser(owner.id,{includeArchived:true}).some(c=>c.id===created.id));
 assert.deepEqual(store.getChatByShareId(before.share!.id),{status:"not_found"});
 assert.deepEqual(trash.listDeletedChats(other.id),[]);
 assert.equal(trash.restoreDeletedChat(created.id,other.id),false);
 assert.throws(()=>store.saveChat(before),/Recently deleted/);
 assert.equal(trash.listDeletedChats(owner.id)[0].title,before.title);
 assert.equal(trash.restoreDeletedChat(created.id,owner.id),true);
 const restored=store.getChat(created.id,owner.id)!;
 assert.deepEqual(restored.messages,before.messages);assert.deepEqual(restored.workspaces,before.workspaces);
 assert.equal(restored.archived,false);assert.equal(restored.runStatus,"idle");assert.equal(restored.share!.active,false);
 assert.notEqual(restored.share!.accessKey,before.share!.accessKey);
 assert.deepEqual(store.getChatByShareId(before.share!.id),{status:"not_found"});
 assert.match(String((sqlite.getDatabase().prepare("SELECT data FROM chat_user_settings WHERE chat_id=? AND user_id=?").get(created.id,owner.id) as {data:string}).data),/saved-model/);
 assert.equal(trash.restoreDeletedChat(created.id,owner.id),false);
});

test("incognito is never retained, permanent deletion cannot be restored",async()=>{
 const [,store,trash]=await modules,owner=await user(),other=await user();
 const secret=store.createChat("Private",undefined,owner.id,undefined,{incognito:true});
 assert.equal(trash.moveChatToTrash(secret.id,owner.id),true);assert.deepEqual(trash.listDeletedChats(owner.id),[]);
 const chat=store.createChat("Delete permanently",undefined,owner.id);
 trash.moveChatToTrash(chat.id,owner.id);
 assert.equal(trash.permanentlyDeleteChat(chat.id,other.id),false);
 assert.equal(trash.permanentlyDeleteChat(chat.id,owner.id),true);
 assert.equal(trash.restoreDeletedChat(chat.id,owner.id),false);
});

test("API requires authentication, validates origin/input and isolates owners",async()=>{
 const [,store,trash]=await modules,owner=await user(),other=await user();
 const route=await import("../app/api/chats/deleted/route");
 for(const method of ["GET","POST","DELETE"] as const) assert.equal((await route[method](request(method))).status,401);
 const chat=store.createChat("API restore",undefined,owner.id);trash.moveChatToTrash(chat.id,owner.id);
 assert.deepEqual((await (await route.GET(request("GET",other.token))).json()).chats,[]);
 assert.equal((await route.POST(request("POST",other.token,{id:chat.id}))).status,404);
 assert.equal((await route.DELETE(request("DELETE",owner.token,{id:chat.id},"https://foreign.test"))).status,403);
 assert.equal((await route.POST(request("POST",owner.token,{id:4}))).status,400);
 assert.equal((await route.POST(request("POST",owner.token,{id:chat.id}))).status,200);
 assert.ok(store.getChat(chat.id,owner.id));
});

test("shared project access is rechecked after deletion and revocation",async()=>{
 const [,store,trash]=await modules,owner=await user(),member=await user(),other=await user();
 const projects=await import("../lib/projects"),sharing=await import("../lib/project-sharing");
 const project=projects.createProject({ownerId:owner.id,name:"Shared trash"});
 const invitation=sharing.inviteProjectMember(project.id,owner.id,member.username);
 sharing.respondProjectInvitation(invitation.id,member.id,"accept");
 const chat=store.createChat("Member chat",undefined,member.id,undefined,{projectId:project.id});
 assert.equal(trash.moveChatToTrash(chat.id,other.id),false);
 assert.equal(trash.moveChatToTrash(chat.id,owner.id),true);
 assert.ok(trash.listDeletedChats(owner.id).some(c=>c.id===chat.id));
 sharing.removeProjectMember(project.id,owner.id,{userId:member.id});
 assert.ok(!trash.listDeletedChats(member.id).some(c=>c.id===chat.id));
 assert.equal(trash.restoreDeletedChat(chat.id,member.id),false);
 assert.equal(trash.restoreDeletedChat(chat.id,owner.id),true);
});

test("brand defaults and old default configuration resolve to Metis; custom names survive",()=>{
 for(const value of [undefined,"","Metis AI"," Metis AI ","Metis"]) assert.equal(productName(value),"Metis");
 assert.equal(productName("My workspace"),"My workspace");
});
