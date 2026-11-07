import fs from "node:fs";
import {requireProtectedLoginIsolation} from "../../lib/native-isolation-policy";
import http from "node:http";
import path from "node:path";
import { SavedBrowserLogins } from "./core";
import { protectedLoginFailure } from "../../lib/protected-login-errors";
import { loadOperatorReturnOrigins } from "./operator-return-origins";

requireProtectedLoginIsolation();
if (!process.getuid || process.getuid() === 0) throw Error("Dedicated non-root identity required");
const state=process.env.STATE_DIRECTORY || "/var/lib/metis-browser-login";
const keyPath=path.join(process.env.CREDENTIALS_DIRECTORY || "/run/credentials/metis-browser-login.service","login.key");
const stat=fs.statSync(keyPath);
if (stat.uid!==process.getuid() || stat.mode&0o077) throw Error("Private key permissions required");
const key=fs.readFileSync(keyPath);
const returnOrigins=loadOperatorReturnOrigins(process.env.METIS_BROWSER_LOGIN_RETURN_ORIGINS_FILE,process.env.NODE_ENV==="test");
const core=new SavedBrowserLogins(key,path.join(state,"logins.sqlite"),process.env.NODE_ENV==="test"?process.env.METIS_BROWSER_LOGIN_TEST_PROXY:undefined,returnOrigins);
const socket=path.join(state,"engine.sock");
if (fs.existsSync(socket)) fs.unlinkSync(socket); // private runtime from this same dedicated service
const server=http.createServer(async(req,res)=>{
  res.setHeader("Content-Type","application/json");res.setHeader("Cache-Control","no-store");res.setHeader("Connection","close");
  try {
    if(req.method!=="POST" || req.url!=="/")throw Error("Denied");
    const chunks:Buffer[]=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>32768)throw Error("Too large");chunks.push(chunk);}
    const body=JSON.parse(Buffer.concat(chunks).toString());
    const result=await core.dispatch(body,body.management===true);
    res.end(JSON.stringify(result));
  }catch(error){res.statusCode=403;res.end(JSON.stringify(protectedLoginFailure(error)));}
});
server.requestTimeout=60000;
server.listen(socket,()=>fs.chmodSync(socket,0o600));
const shutdown=async()=>{server.close();await core.close();key.fill(0);process.exit();};
process.on("SIGTERM",shutdown);process.on("SIGINT",shutdown);
