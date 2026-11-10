import assert from "node:assert/strict";
import test from "node:test";
import {consoleConnectionSchema,consoleTargetInfo,savedLoginSummaries} from "../lib/credential-vault";

test("console connections preserve supported methods and reject arbitrary credential sinks",()=>{
 assert.deepEqual(consoleConnectionSchema.parse({method:"ssh",host:"Host.Example",user:"root"}),{method:"ssh",host:"host.example",port:22,user:"root"});
 for(const value of [{method:"exec",user:"root"},{method:"ssh",host:"-oProxyCommand=bad",user:"root"},{method:"ssh",host:"host",user:"root",port:0},{method:"ssh",host:"host",user:"root",port:true},{method:"sudo",user:"root",host:"remote"},{method:"su",user:"root;bad"},{method:"su",user:"root",command:"anything"}])assert.equal(consoleConnectionSchema.safeParse(value).success,false);
 assert.equal(consoleConnectionSchema.parse({method:"su",user:"root"}).method,"su");
});
test("console summaries retain exact binding and omit secret-bearing or malformed metadata",()=>{
 const target=JSON.stringify(["ssh","host.example",2222,"alice","alice","SHA256:synthetic"]);
 const summary=savedLoginSummaries([{kind:"console",origin:target,password:"NEVER-RETURN",envelope:"NEVER-RETURN"} as never,{origin:"https://portal.example/path",password:"NEVER-RETURN"} as never]);
 assert.equal(summary.length,2);
 assert.equal(summary[0].usage,"console_connect");
 assert.equal(summary[1].usage,"browser_request_login");
 assert(!JSON.stringify(summary).includes("NEVER-RETURN"));
 assert.deepEqual(consoleTargetInfo(target)?.connection,{method:"ssh",host:"host.example",port:2222,user:"alice"});
 for(const value of [JSON.stringify(["ssh","host",22,"other","alice","SHA256:test"]),JSON.stringify(["su","local",22,"alice","alice","local"]),JSON.stringify(["sudo","local",0,"alice","root","SHA256:bad"]),JSON.stringify(["su","local",0,"other","alice","local"]),JSON.stringify(["ssh","host",22,"alice","alice","SHA256:test","extra"]),"not-json"])assert.equal(consoleTargetInfo(value),null);
 assert.deepEqual(savedLoginSummaries([{kind:"console",origin:"not-json"},{origin:"https://user:secret@host"},{origin:"http://host"}]),[]);
});
test("local console summaries show the authenticating account separately from the target account",()=>{
 const target=JSON.stringify(["sudo","metis-host",0,"metis-console","root","local"]);
 const info=consoleTargetInfo(target)!;
 assert.equal(info.authUser,"metis-console");
 assert.deepEqual(info.connection,{method:"sudo",user:"root"});
 assert.equal(info.type,"local");
});
