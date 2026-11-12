import assert from "node:assert/strict";
import {after,test} from "node:test";
import type {IncomingMessage} from "node:http";
import {initializeRequestNetwork,stampRequestNetwork,requestOriginAllowed} from "../lib/request-network";
const old={public:process.env.AI_CHAT_PUBLIC_URL,trust:process.env.AI_CHAT_TRUSTED_PROXIES,key:process.env.METIS_PRIVATE_NETWORK_KEY};
after(()=>{for(const[key,value]of Object.entries({AI_CHAT_PUBLIC_URL:old.public,AI_CHAT_TRUSTED_PROXIES:old.trust,METIS_PRIVATE_NETWORK_KEY:old.key})){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
initializeRequestNetwork();
const request=(origin?:string,headers:Record<string,string>={},url="http://127.0.0.1:3100/api/desktop-assistant/session")=>new Request(url,{method:"PUT",headers:{...headers,...(origin===undefined?{}:{origin})}});
test("public HTTPS origin works with internal HTTP route URLs without accepting other origins",()=>{
 process.env.AI_CHAT_PUBLIC_URL="https://metis.example/base";
 assert.equal(requestOriginAllowed(request("https://metis.example")),true);
 assert.equal(requestOriginAllowed(request()),true);
 for(const origin of ["","null","https://metis.example.evil","https://sibling.metis.example","http://metis.example","https://metis.example:444","https://metis.example/path","https://user@metis.example","file://metis.example","https://metis.example/"])
  assert.equal(requestOriginAllowed(request(origin)),false,origin);
 assert.equal(requestOriginAllowed(request("http://127.0.0.1:3100")),true,"direct development origin");
});
test("signed socket/proxy protocol and Host support self-hosted origins without a public URL",()=>{
 delete process.env.AI_CHAT_PUBLIC_URL;process.env.AI_CHAT_TRUSTED_PROXIES="127.0.0.1";
 const incoming={socket:{remoteAddress:"127.0.0.1"},headers:{host:"selfhost.example:8443","x-forwarded-proto":"https"}} as unknown as IncomingMessage;
 stampRequestNetwork(incoming);
 const headers=incoming.headers as Record<string,string>;
 assert.equal(requestOriginAllowed(request("https://selfhost.example:8443",headers)),true);
 assert.equal(requestOriginAllowed(request("https://selfhost.example",headers)),false);
 for(const host of ["user@selfhost.example:8443","selfhost.example:8443/path","selfhost.example:8443?query","selfhost.example:8443#fragment","selfhost.example:8443\\other","selfhost.example:8443 path"])
  assert.equal(requestOriginAllowed(request("https://selfhost.example:8443",{...headers,host})),false,host);
 assert.equal(requestOriginAllowed(request("https://selfhost.example:8443",{...headers,"x-metis-network":"forged.forged"})),false);
});
test("unverified forwarding, null origins and proxy lookalikes do not bypass origin checks",()=>{
 delete process.env.AI_CHAT_PUBLIC_URL;delete process.env.AI_CHAT_TRUSTED_PROXIES;
 const headers={host:"selfhost.example","x-forwarded-proto":"https","x-forwarded-host":"selfhost.example"};
 assert.equal(requestOriginAllowed(request("https://selfhost.example",headers)),false);
 const incoming={socket:{remoteAddress:"192.0.2.9"},headers:{...headers}} as unknown as IncomingMessage;
 stampRequestNetwork(incoming);
 assert.equal(requestOriginAllowed(request("https://selfhost.example",incoming.headers as Record<string,string>)),false);
 assert.equal(requestOriginAllowed(request("null",incoming.headers as Record<string,string>)),false);
});
test("malformed optional public URL grants no origin; actual HTTPS requests still work",()=>{
 process.env.AI_CHAT_PUBLIC_URL="not a URL";
 assert.equal(requestOriginAllowed(request("https://real.example",{},"https://real.example/api")),true);
 assert.equal(requestOriginAllowed(request("https://other.example",{},"https://real.example/api")),false);
});
