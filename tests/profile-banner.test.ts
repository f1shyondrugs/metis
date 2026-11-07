import assert from "node:assert/strict";
import test, {after} from "node:test";
import {mkdtempSync, rmSync, readdirSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import sharp from "sharp";
import {MAX_INLINE_IMAGE_BYTES} from "../lib/upload-limits";
import {withImageFraming} from "../lib/image-framing";
const root = mkdtempSync(path.join(tmpdir(), "metis-profile-banner-"));
Object.assign(process.env, {CHAT_DATA_DIR:root, CHAT_DB_PATH:path.join(root,"test.sqlite"), AI_CHAT_ROOT:root, AGENT_CWD:root});
after(async()=>{(await import("../lib/sqlite")).getDatabase().close();rmSync(root,{recursive:true,force:true});});
const base={displayName:"Banner test",bio:"",avatar:null,links:[],sharing:false,shareActivity:false};
async function owner(name:string) {
  const auth=await import("../lib/auth");
  const user=auth.createUser(name,"banner-fixture-password");
  return {...user,token:auth.authenticateUser(name,"banner-fixture-password")!.token};
}
function upload(bytes:Uint8Array,token?:string,mime="image/png",extra:Record<string,string>={}) {
  return new Request("http://localhost/api/profile/banner",{method:"PUT",headers:{"content-type":mime,...(token?{cookie:"ai_chat_auth="+token}:{}),...extra},body:new Uint8Array(bytes)});
}
async function image(url:string,token?:string,etag?:string) {
  const {GET}=await import("../app/api/profile/banner/[bannerId]/route");
  return GET(new Request("http://localhost"+url,{headers:{...(token?{cookie:"ai_chat_auth="+token}:{}),...(etag?{"if-none-match":etag}:{})}}),{params:Promise.resolve({bannerId:url.split("#")[0].split("/").at(-1)!})});
}
async function png() {return sharp({create:{width:600,height:300,channels:4,background:"#126b9a"}}).png().toBuffer();}
test("upload authenticates, preserves original bytes, and isolates unpublished banners",async()=>{
  const {PUT}=await import("../app/api/profile/banner/route");
  const user=await owner("banner-upload"),other=await owner("banner-other"),bytes=await png();
  assert.equal((await PUT(upload(bytes))).status,401);
  const response=await PUT(upload(bytes,user.token));assert.equal(response.status,200);
  const {banner}=await response.json();
  assert.equal((await image(banner)).status,404);assert.equal((await image(banner,other.token)).status,404);
  const saved=await image(banner,user.token);assert.equal(saved.headers.get("content-type"),"image/png");
  assert.deepEqual(Buffer.from(await saved.arrayBuffer()),bytes);
  const {saveAccountProfile}=await import("../lib/account-profile");
  assert.throws(()=>saveAccountProfile(other.id,{...base,banner}));
});
test("fit and crop persist, legacy saves retain the banner, public access rechecks revocation",async()=>{
  const user=await owner("banner-persistence"),{PUT}=await import("../app/api/profile/banner/route");
  const {saveAccountProfile,getAccountProfile,getSharedProfile}=await import("../lib/account-profile");
  const {banner}=await (await PUT(upload(await png(),user.token))).json();
  const modes=[{mode:"fit" as const},{mode:"crop" as const,area:{x:10,y:20,width:70,height:35}},{mode:"fit" as const,bannerStyle:"fade" as const},{mode:"crop" as const,area:{x:10,y:20,width:70,height:35},bannerStyle:"fade" as const}];
  for(const mode of modes) {
    const value=withImageFraming(banner,mode);
    const saved=saveAccountProfile(user.id,{...base,banner:value,sharing:true});
    assert.equal(getAccountProfile(user.id,user.username).banner,value);
    assert.equal(getSharedProfile(saved.shareId!)?.profile.banner,value);
    saveAccountProfile(user.id,{...base,sharing:true});
    assert.equal(getAccountProfile(user.id,user.username).banner,value);
  }
  const publicImage=await image(banner);assert.equal(publicImage.status,200);
  const etag=publicImage.headers.get("etag")!;await publicImage.arrayBuffer();
  assert.equal((await image(banner,undefined,etag)).status,304);
  saveAccountProfile(user.id,{...base,sharing:false});
  assert.equal((await image(banner,undefined,etag)).status,404);
  assert.equal((await image(banner,user.token,etag)).status,304);
  saveAccountProfile(user.id,{...base,banner:null});
  assert.equal((await image(banner,user.token)).status,404);
});
test("replacement retains saved banner until profile save and cleans discarded drafts",async()=>{
  const user=await owner("banner-replace"),{PUT}=await import("../app/api/profile/banner/route");
  const {saveAccountProfile}=await import("../lib/account-profile");
  const bytes=await png();
  const first=(await (await PUT(upload(bytes,user.token))).json()).banner;
  saveAccountProfile(user.id,{...base,banner:first});
  const draft=(await (await PUT(upload(bytes,user.token))).json()).banner;
  const next=(await (await PUT(upload(bytes,user.token))).json()).banner;
  assert.equal((await image(first,user.token)).status,200);
  assert.equal((await image(draft,user.token)).status,404);
  saveAccountProfile(user.id,{...base,banner:next});
  assert.equal((await image(first,user.token)).status,404);
  assert.equal((await image(next,user.token)).status,200);
});
test("GIF banners preserve animation bytes",async()=>{
  const user=await owner("banner-gif"),{PUT}=await import("../app/api/profile/banner/route");
  const bytes=await sharp({create:{width:20,height:10,channels:4,background:"#f00"}}).gif().toBuffer();
  const response=await PUT(upload(bytes,user.token,"image/gif"));assert.equal(response.status,200);
  const {banner}=await response.json(),loaded=await image(banner,user.token);
  assert.equal(loaded.headers.get("content-type"),"image/gif");assert.deepEqual(Buffer.from(await loaded.arrayBuffer()),bytes);
});
test("invalid types, spoofed content, malformed framing and oversized streams are rejected",async()=>{
  const user=await owner("banner-invalid"),{PUT}=await import("../app/api/profile/banner/route");
  const {saveAccountProfile}=await import("../lib/account-profile");
  const count=()=>readdirSync(path.join(root,"profile-banners")).length,before=count();
  assert.equal((await PUT(upload(await png(),user.token,"image/svg+xml"))).status,415);
  assert.equal((await PUT(upload(await png(),user.token,"image/gif"))).status,400);
  assert.equal((await PUT(upload(Buffer.from("<script>bad</script>"),user.token))).status,400);
  assert.equal((await PUT(upload(new Uint8Array(),user.token))).status,400);
  assert.equal((await PUT(upload(await png(),user.token,"image/png",{"content-length":String(MAX_INLINE_IMAGE_BYTES+1)}))).status,413);
  const stream=new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(MAX_INLINE_IMAGE_BYTES+1));c.close();}});
  const request=new Request("http://localhost/api/profile/banner",{method:"PUT",headers:{"content-type":"image/png",cookie:"ai_chat_auth="+user.token},body:stream,duplex:"half"} as RequestInit);
  assert.equal((await PUT(request)).status,413);assert.equal(count(),before);
  for(const banner of ["https://example.com/a.png","/api/profile/banner/"+"0".repeat(48),"/api/profile/banner/"+"0".repeat(48)+"#metis-image=crop,0,0,0,100"])
    assert.throws(()=>saveAccountProfile(user.id,{...base,banner}));
});
