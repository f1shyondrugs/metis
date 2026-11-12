import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const packageRoot=process.argv[2];assert(packageRoot&&path.isAbsolute(packageRoot));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'icloud-extension-check-'));
fs.writeFileSync(path.join(temp,'config.json'),JSON.stringify({dataDir:path.join(temp,'data')}));
fs.writeFileSync(path.join(temp,'block-network.mjs'),"globalThis.fetch=async()=>{throw Error('Network deliberately disabled for isolated testing');};");
const client=new Client({name:'isolated-icloud-extension-check',version:'1'},{capabilities:{}});
const transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('integrations/icloud-calendar/cli.mjs'),packageRoot],env:{PATH:process.env.PATH,HOME:temp,ICLOUD_USERNAME:'synthetic@example.invalid',ICLOUD_APP_PASSWORD:'SYNTHETIC-TEST-PASSWORD',ICLOUD_MCP_TRANSPORT:'stdio',ICLOUD_MCP_CONFIG:path.join(temp,'config.json'),NODE_OPTIONS:'--import='+path.join(temp,'block-network.mjs')},stderr:'pipe'});
let stderr='';transport.stderr?.on('data',data=>{stderr+=data.toString();});
try{
 await client.connect(transport);const result=await client.listTools();
 for(const name of ['list_calendars','list_events','get_event','create_event','update_event','delete_event','find_conflicts','free_busy','get_calendar_properties','create_calendar','move_event'])assert(result.tools.some(tool=>tool.name===name));
 const schema=result.tools.find(tool=>tool.name==='create_calendar').inputSchema.properties.color;
 assert(new RegExp(schema.pattern).test('#FF3B30FF'));assert(new RegExp(schema.pattern).test('#ff3b30ff'));
 const reply=await client.callTool({name:'get_calendar_properties',arguments:{}});
 assert(reply.isError);assert(!JSON.stringify(reply).includes('SYNTHETIC-TEST-PASSWORD'));assert(!stderr.includes('SYNTHETIC-TEST-PASSWORD'));
 console.log('ICLOUD_EXTENSION_STDIO_VERIFIED EXISTING_TOOLS_PRESERVED NETWORK_DISABLED SAFE_ERRORS');
}finally{await client.close();fs.rmSync(temp,{recursive:true,force:true});}
