import http from "node:http";
import {parseProtectedLoginReply,type ProtectedLoginReply} from "../../lib/protected-login-contract";
export function secureConsole(owner:string,chat:string,operation:string,input:unknown={}):Promise<ProtectedLoginReply>{
  return new Promise((resolve,reject)=>{
    const body=JSON.stringify({owner,chat,operation,input});
    const request=http.request({socketPath:process.env.METIS_SECURE_CONSOLE_SOCKET || "/run/metis-secure-console/engine.sock",path:"/",method:"POST",agent:false,timeout:45000,headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(body),Connection:"close"}},response=>{
      let output="";response.on("data",chunk=>{output+=chunk;if(output.length>1000000)response.destroy();});
      response.on("error",()=>reject(Error("Secure console unavailable")));
      response.on("end",()=>{if(response.statusCode!==200)return reject(Error("Secure console operation denied"));try{resolve(parseProtectedLoginReply(JSON.parse(output)));}catch{reject(Error("Secure console unavailable"));}});
    });
    request.on("timeout",()=>request.destroy());request.on("error",()=>reject(Error("Secure console unavailable")));request.end(body);
  });
}
