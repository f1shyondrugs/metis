import {createHmac,timingSafeEqual} from "node:crypto";

export function signShareCredential(scope:string,key:string,expires=Date.now()+12*60*60*1000) {
  const expiry=String(expires);
  return expiry+"."+createHmac("sha256",key).update(scope+":"+expiry).digest("base64url");
}
export function verifyShareCredential(scope:string,key:string,credential?:string) {
  if(!key||!credential)return false;
  const [expires,signature,extra]=credential.split(".");
  if(extra||!/^\d{13}$/.test(expires||"")||!signature||Number(expires)<=Date.now())return false;
  const expected=Buffer.from(signShareCredential(scope,key,Number(expires)).split(".")[1]),actual=Buffer.from(signature);
  return actual.length===expected.length&&timingSafeEqual(actual,expected);
}
