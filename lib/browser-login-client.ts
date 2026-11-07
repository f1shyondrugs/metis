import http from "node:http";
import {parseProtectedLoginReply,type ProtectedLoginReply} from "./protected-login-contract";
import {requireProtectedLoginIsolation} from "./native-isolation-policy";
import { ProtectedLoginError } from "./protected-login-errors";

// Next's custom server may expose an internal localhost URL in route handlers.
// The actual HTTP Host remains the browser's target; never trust forwarded host.
export function browserLoginSameOrigin(req:Request) {
  try {
    const raw=req.headers.get("origin");if(!raw)return false;
    const origin=new URL(raw);
    if(!["http:","https:"].includes(origin.protocol) || raw!==origin.origin)return false;
    const target=new URL(`${origin.protocol}//${req.headers.get("host") || new URL(req.url).host}`);
    return target.host===origin.host;
  }catch{return false;}
}

export function browserLoginRequest(owner: string, chat: string | undefined, operation: string, input: unknown={}, management=false): Promise<ProtectedLoginReply> {
  try { requireProtectedLoginIsolation(); }
  catch { return Promise.reject(new ProtectedLoginError("isolation_required")); }
  return new Promise((resolve,reject)=>{
    const body=JSON.stringify({owner,chat,operation,input,management});
    const request=http.request({socketPath:process.env.METIS_BROWSER_LOGIN_SOCKET || "/run/metis-browser-login/client.sock",path:"/",method:"POST",agent:false,
      headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(body),Connection:"close"},timeout:60000},response=>{
      let size=0;const chunks:Buffer[]=[];
      response.on("data",chunk=>{size+=chunk.length;if(size>1024*1024)response.destroy();else chunks.push(chunk);});
      response.on("error",()=>reject(new ProtectedLoginError()));
      response.on("end",()=>{
        let result: ProtectedLoginReply;
        try { result = parseProtectedLoginReply(JSON.parse(Buffer.concat(chunks).toString())); }
        catch { return reject(new ProtectedLoginError()); }
        if(response.statusCode!==200)return reject(new ProtectedLoginError(result?.code));
        resolve(result);
      });
    });
    request.on("timeout",()=>request.destroy());request.on("error",()=>reject(new ProtectedLoginError()));
    request.end(body);
  });
}
