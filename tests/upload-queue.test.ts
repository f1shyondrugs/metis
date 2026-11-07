import assert from "node:assert/strict";
import test from "node:test";
import { readTextFilePreview } from "../lib/text-file-preview";
test("large text previews stop reading and cancel the download at the preview budget", async () => {
  let reads=0, cancelled=false;
  const body = new ReadableStream<Uint8Array>({ pull(controller) { reads++; controller.enqueue(new Uint8Array(16).fill(65)); }, cancel(){cancelled=true;} });
  const preview=await readTextFilePreview(new Response(body),32);
  assert.ok(preview.startsWith("A".repeat(32)));
  assert.match(preview,/truncated/);
  assert.equal(cancelled,true);
  assert.ok(reads<=3);
});
test("completed rows expire after five seconds, while results stay attachable and pending transfers remain", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const originalFetch=globalThis.fetch, originalXhr=globalThis.XMLHttpRequest;
  const offsets=new Map<string,number>(), sizes=new Map<string,number>();
  let nextId=0;
  const pending: Array<() => void>=[];
  class Xhr {
    upload={onprogress:null as null|((event:{loaded:number})=>void)};
    onload?:()=>void; onerror?:()=>void; onabort?:()=>void;
    status=200; responseText=""; id=""; offset=0;
    open(_method:string,url:string){this.id=url.split("/").at(-1)!;}
    setRequestHeader(_name:string,value:string){this.offset=Number(value);}
    send(blob:Blob){pending.push(()=>{this.upload.onprogress?.({loaded:blob.size});offsets.set(this.id,this.offset+blob.size);this.onload?.();});}
    abort(){this.onabort?.();}
  }
  globalThis.XMLHttpRequest=Xhr as unknown as typeof XMLHttpRequest;
  globalThis.fetch=async (input,init)=>{
    const url=String(input),id=url.split("/").at(-1)!;
    if(url==="/api/file-uploads"){
      const body=JSON.parse(init!.body as string),created=String(++nextId);
      offsets.set(created,0);sizes.set(created,body.size);
      return Response.json({id:created,offset:0});
    }
    if(init?.method==="POST") return Response.json({id,name:"file.bin",size:sizes.get(id),kind:"file",mimeType:"application/octet-stream"});
    return Response.json({offset:offsets.get(id)});
  };
  try {
    const {startUpload,waitForUpload,getUploadSnapshot,getUploadStatus,dismissUpload}=await import("../lib/background-uploads");
    let currentView="Chat A", completedIn="";
    const id=startUpload(new File(["background"],"background.bin"),{label:"Chat A",onComplete:async()=>{completedIn=currentView;}});
    currentView="Chat B";
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(getUploadSnapshot().find(task=>task.id===id)?.status,"uploading");
    assert.equal(getUploadStatus(id), "uploading");
    pending.shift()!();
    const result=await waitForUpload(id);
    assert.equal(completedIn,"Chat B");
    assert.equal(result.size,10);
    assert.equal(getUploadSnapshot().some(task=>task.id===id),true);
    t.mock.timers.tick(4_999);
    assert.equal(getUploadSnapshot().some(task=>task.id===id),true);
    const pendingId=startUpload(new File(["still pending"],"pending.bin"),{label:"Chat B"});
    t.mock.timers.tick(1);
    assert.equal(getUploadSnapshot().some(task=>task.id===id),false);
    assert.equal(getUploadSnapshot().some(task=>task.id===pendingId),true);
    dismissUpload(id);
    assert.equal((await waitForUpload(id)).id,result.id);
    assert.equal(getUploadStatus(id), "completed");
  } finally {globalThis.fetch=originalFetch;globalThis.XMLHttpRequest=originalXhr;}
});
