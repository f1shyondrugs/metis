import assert from 'node:assert/strict';
import test from 'node:test';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {signTrustedMcpSession} from '../lib/mcp-core/session-token.mjs';
test('real HTTP MCP transport rejects another signed owner/run using a captured session ID',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'metis-mcp-owner-'));
 const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 const secret='TEST-MCP-OWNER-BOUNDARY-KEY';
 const child=spawn(process.execPath,['lib/mcp-core/gateway-core.mjs','--http'],{cwd:process.cwd(),env:{...process.env,MCP_HOST:'127.0.0.1',MCP_PORT:String(port),MCP_BEARER_TOKEN:secret,AI_CHAT_MCP_STATE_DIR:dir,AI_CHAT_INTERNAL_ORIGIN:'http://127.0.0.1:1'},stdio:['ignore','pipe','pipe']});
 child.stdout.resume();let errors='';child.stderr.on('data',v=>errors+=v);
 t.after(async()=>{child.kill('SIGTERM');await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));fs.rmSync(dir,{recursive:true,force:true});});
 const root=`http://127.0.0.1:${port}/mcp`;
 for(let i=0;i<100;i++){try{await fetch(root);break;}catch{}if(child.exitCode!==null)throw Error(errors);await new Promise(r=>setTimeout(r,50));}
 const token=(owner,job)=>signTrustedMcpSession({v:1,trustedInternal:true,exp:Date.now()+60000,userId:owner,jobId:job,chatId:owner+'-chat',uid:1000,gid:1000,workspaceRoot:dir,home:dir},secret);
 const a=token('alice','run-a'),b=token('bob','run-b'),otherRun=token('alice','run-other');
 const headers=(credential,sid)=>({Authorization:'Bearer '+credential,'Content-Type':'application/json',Accept:'application/json, text/event-stream',...(sid?{'Mcp-Session-Id':sid}:{})});
 const init=await fetch(root,{method:'POST',headers:headers(a),body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'owner-test',version:'1'}}})});
 assert.equal(init.status,200,await init.clone().text());const sid=init.headers.get('mcp-session-id');assert(sid);await init.text();
 const notify=await fetch(root,{method:'POST',headers:headers(a,sid),body:JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})});await notify.text();
 for(const credential of [b,otherRun,secret])for(const method of ['POST','GET','DELETE']){
  const response=await fetch(root,{method,headers:headers(credential,sid),...(method==='POST'?{body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list'})}:{})});assert.equal(response.status,403);await response.text();
 }
 const own=await fetch(root,{method:'POST',headers:headers(a,sid),body:JSON.stringify({jsonrpc:'2.0',id:3,method:'tools/list'})});assert.equal(own.status,200);await own.text();
});
