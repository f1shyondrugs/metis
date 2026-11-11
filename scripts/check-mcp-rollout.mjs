import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const [oldUrl,newUrl,dir]=process.argv.slice(2);
if(!oldUrl||!newUrl||!dir)throw Error('Expected old/new loopback endpoints and evidence directory');
const headers={Authorization:'Bearer '+process.env.MCP_BEARER_TOKEN};
async function connect(url){const client=new Client({name:'metis-rollout-verification',version:'1'},{capabilities:{}});const transport=new StreamableHTTPClientTransport(new URL(url+'/mcp'),{requestInit:{headers}});await client.connect(transport);return {client,transport};}
const old=await connect(oldUrl);
try{
 assert(!(await old.client.callTool({name:'gateway_status',arguments:{}})).isError);
 fs.writeFileSync(dir+'/old-session-ready','ready',{mode:0o600});
 const deadline=Date.now()+120000;while(!fs.existsSync(dir+'/new-gateway-ready')){if(Date.now()>deadline)throw Error('Rollout verification timed out');await new Promise(resolve=>setTimeout(resolve,250));}
 const fresh=await connect(newUrl);
 try{
  const catalog=await fresh.client.listTools();
  for(const name of ['credential_vault_list','mcp_request_credentials'])assert(catalog.tools.some(tool=>tool.name===name));
  assert(!(await fresh.client.callTool({name:'gateway_status',arguments:{}})).isError);
  assert(!(await old.client.callTool({name:'gateway_status',arguments:{}})).isError);
  fs.writeFileSync(dir+'/rollout.json',JSON.stringify({authenticatedInitialize:true,newToolsPresent:true,oldSessionContinued:true,checkedAt:new Date().toISOString()},null,2),{mode:0o600});
  console.log('NEW_GATEWAY_AUTHENTICATED OLD_SESSION_CONTINUED VAULT_TOOLS_PRESENT');
 }finally{await fresh.client.close();}
}finally{await old.client.close();}
