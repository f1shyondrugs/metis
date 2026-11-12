import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
test('environment replacement preserves active calls and excludes application secrets from children',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'metis-mcp-lifecycle-'));
 const file=path.join(root,'server.mjs'),state=path.join(root,'state');fs.mkdirSync(state);
 Object.assign(process.env,{AI_CHAT_INTERNAL_ORIGIN:"http://127.0.0.1:1",AI_CHAT_ROOT:root,AI_CHAT_MCP_STATE_DIR:state,AI_CHAT_SECRETS_KEY:'03'.repeat(32),MCP_BEARER_TOKEN:'synthetic-application-token'});
 const sdk=pathToFileURL(path.resolve('node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js')).href;
 const stdio=pathToFileURL(path.resolve('node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js')).href;
 const types=pathToFileURL(path.resolve('node_modules/@modelcontextprotocol/sdk/dist/esm/types.js')).href;
 fs.writeFileSync(file,`import {Server} from ${JSON.stringify(sdk)};import {StdioServerTransport} from ${JSON.stringify(stdio)};import {ListToolsRequestSchema,CallToolRequestSchema} from ${JSON.stringify(types)};
 const server=new Server({name:'synthetic-env-child',version:'1'},{capabilities:{tools:{}}});
 server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{name:'check',inputSchema:{type:'object',properties:{delay:{type:'number'}}}}]}));
 server.setRequestHandler(CallToolRequestSchema,async(req)=>{const value=process.env.TEST_VALUE;await new Promise(r=>setTimeout(r,req.params.arguments?.delay||0));return {content:[{type:'text',text:JSON.stringify({value,appSecret:!!process.env.AI_CHAT_SECRETS_KEY,token:!!process.env.MCP_BEARER_TOKEN})}]};});
 await server.connect(new StdioServerTransport());`);
 const entry={id:'test-env',ownerId:'owner',name:'Synthetic',kind:'stdio',command:process.execPath,args:[file],env:{TEST_VALUE:'old'},enabled:true};
 fs.writeFileSync(path.join(state,'registry.json'),JSON.stringify({version:1,servers:[entry]}));
 const {dispatchGatewayTool,getMcpEnvironment,updateMcpEnvironment,removeMcpServer}=await import('../lib/mcp-core/gateway-core.mjs');
 const context={userId:'owner',isHostAdmin:true};
 const call=async(delay)=>{const result=await dispatchGatewayTool('call_mcp_tool',{server:'test-env',tool:'check',arguments:{delay}},{context,auditCall:false});assert(!result.isError,JSON.stringify(result));return JSON.parse(result.content[0].text);};
 try{
  await dispatchGatewayTool('list_server_tools',{server:'test-env'},{context,auditCall:false});
  const first=call(500);await new Promise(r=>setTimeout(r,100));
  const metadata=await getMcpEnvironment('test-env',context);
  await updateMcpEnvironment('test-env',{revision:metadata.revision,set:{TEST_VALUE:'new'}},context);
  const second=await call(0);
  assert.deepEqual(second,{value:'new',appSecret:false,token:false});
  assert.deepEqual(await first,{value:'old',appSecret:false,token:false});
 }finally{await removeMcpServer('test-env',context);fs.rmSync(root,{recursive:true,force:true});}
});
