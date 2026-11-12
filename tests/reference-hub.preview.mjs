// Isolated account and data only. No production sessions or credentials.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import {notesNavigationHarnessSource} from './project-notes-navigation-harness.mjs';
import {importWorkerModule} from '../lib/worker-module.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'metis-reference-ui-'));
Object.assign(process.env,{AI_CHAT_ROOT:root,AI_CHAT_INSTALL_DIR:process.cwd(),CHAT_DATA_DIR:root,CHAT_DB_PATH:path.join(root,'chat.sqlite'),AGENT_CWD:root,CHAT_LEGACY_HEADER_AUTH:'false'});
const [{createUser,authenticateUser},store,notesModule,issues,route]=await Promise.all([
 importWorkerModule('../lib/auth.ts'),importWorkerModule('../lib/db-store.ts'),importWorkerModule('../lib/shared-context.ts'),importWorkerModule('../lib/issues.ts'),importWorkerModule('../app/api/references/route.ts')]);
const owner=createUser('synthetic-reference-ui','SYNTHETIC-LOCAL-ONLY').id,token=authenticateUser('synthetic-reference-ui','SYNTHETIC-LOCAL-ONLY').token,stamp=new Date().toISOString();
const chat=store.createChat('Unrelated conversation',undefined,owner);
chat.messages=Array.from({length:20},(_,i)=>({id:'message-'+i,role:'user',content:'bodyonlyneedle',createdAt:stamp}));
chat.messages[0].tools=[{id:'file',name:'read_file',status:'completed',input:{path:'/fixture/report.md'},result:'Synthetic report'}];
chat.workspaces=[{id:'canvas',type:'canvas',name:'Long canvas',content:'x'.repeat(9000)+' tailcanvasneedle',createdAt:stamp,updatedAt:stamp},{id:'plan',type:'plan',name:'Long plan',content:'x'.repeat(9000)+' tailplanneedle',createdAt:stamp,updatedAt:stamp}];
chat.browserContext={tabs:[{id:'browser',title:'School Portal',url:'https://school.example.invalid'}],activeTabId:'browser',sessionKey:'fixture',updatedAt:stamp};
chat.sessionState={terminalTabs:[{id:'terminal',title:'Build terminal',cwd:'/fixture'}]};store.saveChat(chat);
const previews=Array.from({length:9},(_,i)=>notesModule.createNote({ownerId:owner,title:i===1?'Very long project note title that must remain accessible but cannot widen the whole project hub '.repeat(2):'Project note '+(i+1),content:'Synthetic project note',icon:'lucide:sticky-note'}));
notesModule.createNote({ownerId:owner,title:'Long note',content:'x'.repeat(9000)+' tailnoteneedle',icon:'lucide:sticky-note'});
notesModule.createNote({ownerId:owner,kind:'learned_fact',title:'Fixture memory',content:'Remember the fixture settings'});
issues.createIssue(owner,{title:'Fixture issue',description:'Synthetic issue'});
const directory=path.resolve('output/reference-hub-ui');fs.mkdirSync(directory,{recursive:true});
const require=createRequire(import.meta.url),{build}=createRequire(require.resolve('tsx'))('esbuild');
await build({entryPoints:['tests/reference-hub.browser.tsx'],outfile:directory+'/app.js',bundle:true,platform:'browser',format:'esm',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
const css=await postcss([tailwind()]).process(fs.readFileSync('app/globals.css','utf8'),{from:'app/globals.css'});fs.writeFileSync(directory+'/theme.css',css.css);
fs.writeFileSync(directory+'/navigation.js',notesNavigationHarnessSource()+'\nwindow.createNotesNavigationHarness=createNotesNavigationHarness;');
const app='<html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reference and project notes fixture</title><link rel="stylesheet" href="/theme.css"><body><div id="root"></div><script src="/navigation.js"></script><script type="module" src="/app.js"></script></body></html>';
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/api/references'){
  try{const response=await route.GET(new Request('http://localhost'+req.url,{headers:{cookie:'ai_chat_auth='+token}}));res.writeHead(response.status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(await response.text());}catch{res.writeHead(500).end('{}');}return;
 }
 if(url.pathname==='/fixture-data'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({notes:previews.map(({id,title,color})=>({id,title,color}))}));return;}
 if(url.pathname==='/report'&&req.method==='POST'){let body='';for await(const chunk of req)body+=chunk;const result=JSON.parse(body);fs.writeFileSync(directory+'/result-'+result.width+'.json',JSON.stringify(result,null,2));res.end('saved');return;}
 if(url.pathname==='/app.html'){res.setHeader('Content-Type','text/html');res.end(app);return;}
 if(url.pathname==='/'){const width=Number(url.searchParams.get('width')||960);if(![390,768,960,1440].includes(width)){res.writeHead(400).end();return;}res.setHeader('Content-Type','text/html');res.end('<html><head><title>Responsive reference fixture</title><style>body{margin:0;background:#111}iframe{display:block;border:0;width:'+width+'px;height:1700px;margin:0 auto}</style></head><body><iframe src="/app.html"></iframe></body></html>');return;}
 const name=url.pathname.slice(1);if(!['app.js','theme.css','navigation.js'].includes(name)){res.writeHead(404).end();return;}
 res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':'text/css');res.end(fs.readFileSync(directory+'/'+name));
});
server.listen(3264,'127.0.0.1',()=>console.log('REFERENCE_HUB_FIXTURE_READY'));
process.on('SIGTERM',()=>server.close(()=>{fs.rmSync(root,{recursive:true,force:true});process.exit(0);}));
