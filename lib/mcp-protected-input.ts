import {randomUUID} from "node:crypto";
import {getDatabase} from "@/lib/sqlite";
import {z} from "zod";
async function gateway(){
 // @ts-expect-error Shared gateway ESM runtime boundary.
 return import("@/packages/mcp-gateway/index.mjs");
}

export const mcpInputRequestSchema=z.object({server:z.string().regex(/^[a-z0-9][a-z0-9._-]{1,63}$/),fields:z.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/)).min(1).max(32)}).strict();
type Row={id:string;owner:string;chat:string;job:string;server:string;fields:string;revision:string;expires:number;filled:number};
function db(){
 const db=getDatabase();
 db.exec("CREATE TABLE IF NOT EXISTS mcp_protected_requests(id TEXT PRIMARY KEY,owner TEXT NOT NULL,chat TEXT NOT NULL,job TEXT NOT NULL,server TEXT NOT NULL,fields TEXT NOT NULL,revision TEXT NOT NULL,expires INTEGER NOT NULL,filled INTEGER NOT NULL DEFAULT 0)");
 return db;
}
export async function prepareMcpInput(owner:string,chat:string,job:string,raw:unknown) {
 const {server,fields}=mcpInputRequestSchema.parse(raw);
 if(new Set(fields).size!==fields.length)throw Error("Duplicate environment fields.");
 const {getMcpEnvironment}=await gateway();
 const target=await getMcpEnvironment(server,{userId:owner});
 const id=randomUUID(),expires=Date.now()+15*60*1000;
 db().prepare("DELETE FROM mcp_protected_requests WHERE expires < ?").run(Date.now());
 db().prepare("INSERT INTO mcp_protected_requests(id,owner,chat,job,server,fields,revision,expires) VALUES(?,?,?,?,?,?,?,?)").run(id,owner,chat,job,server,JSON.stringify(fields),target.revision,expires);
 return {requestId:id,origin:server,expiresAt:new Date(expires).toISOString(),kind:"mcp" as const,envFields:fields};
}
function request(owner:string,chat:string,job:string,id:string):Row{
 const row=db().prepare("SELECT * FROM mcp_protected_requests WHERE id=? AND owner=? AND chat=? AND job=? AND expires>?").get(id,owner,chat,job,Date.now()) as Row|undefined;
 if(!row)throw Error("Protected MCP form is unavailable.");
 return row;
}
export async function fillMcpInput(owner:string,chat:string,job:string,id:string,values:unknown){
 const row=request(owner,chat,job,id);
 if(row.filled)throw Error("This protected form was already submitted.");
 const fields=JSON.parse(row.fields) as string[];
 const parsed=z.record(z.string(),z.string().min(1).max(16384).refine(value=>!value.includes("\0"))).parse(values);
 if(Object.keys(parsed).length!==fields.length||fields.some(field=>!Object.hasOwn(parsed,field)))throw Error("Enter only the requested MCP fields.");
 // CAS reserves this one-use request before the asynchronous registry write.
 if(db().prepare("UPDATE mcp_protected_requests SET filled=-1 WHERE id=? AND filled=0").run(id).changes!==1)throw Error("This protected form was already submitted.");
 try{
  const {updateMcpEnvironment}=await gateway();
  await updateMcpEnvironment(row.server,{set:parsed,revision:row.revision},{userId:owner});
  db().prepare("UPDATE mcp_protected_requests SET filled=1 WHERE id=?").run(id);
 }catch(error){
  db().prepare("DELETE FROM mcp_protected_requests WHERE id=?").run(id);
  throw error;
 }finally{for(const name of Object.keys(parsed))parsed[name]="";}
 return {status:"configured",server:row.server};
}
export function mcpInputStatus(owner:string,chat:string,job:string,id:string){
 const row=request(owner,chat,job,id);
 return {filled:row.filled===1,scope:"permanent" as const};
}
