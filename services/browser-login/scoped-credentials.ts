import {createHash} from "node:crypto";
import type {DatabaseSync} from "node:sqlite";
import {seal,unseal} from "./credential-envelope.mjs";

export type CredentialKind="browser"|"console";
type Temporary={owner:string;chat:string;kind:CredentialKind;target:string;envelope:string;expires:number};
export class ScopedCredentials {
  private temporary=new Map<string,Temporary>();
  constructor(private key:Buffer,private db:DatabaseSync){
    db.exec("CREATE TABLE IF NOT EXISTS console_logins(owner TEXT NOT NULL,target TEXT NOT NULL,label TEXT NOT NULL,envelope TEXT NOT NULL,PRIMARY KEY(owner,target));");
  }
  private id(kind:CredentialKind,target:string,chat?:string){return createHash("sha256").update(`${chat?`chat:${chat}:`:""}${kind==="console"?"console:":""}${target}`).digest("hex");}
  private slot(owner:string,chat:string,kind:CredentialKind,target:string){return JSON.stringify([owner,chat,kind,target]);}
  private identityBinding(values:Record<string,unknown>){return createHash("sha256").update(JSON.stringify([values.username??null,values.email??null])).digest("hex");}
  get(owner:string,chat:string,kind:CredentialKind,target:string):Record<string,unknown>|null{
    for(const [id,item]of this.temporary)if(item.expires<=Date.now())this.temporary.delete(id);
    const item=this.temporary.get(this.slot(owner,chat,kind,target));
    const saved=this.permanent(owner,kind,target);
    const result=item?{...saved,...unseal(this.key,owner,this.id(kind,target,chat),item.envelope) as Record<string,unknown>}:saved;
    if(result){
      if(result.password===null&&typeof saved?.password==="string"&&saved.passwordIdentityBinding===this.identityBinding(result))result.password=saved.password;
      if(result.password===null||kind==="browser"&&typeof result.passwordIdentityBinding==="string"&&result.passwordIdentityBinding!==this.identityBinding(result))delete result.password;
      delete result.passwordIdentityBinding;
    }
    return result;
  }
  private permanent(owner:string,kind:CredentialKind,target:string):Record<string,unknown>|null{
    const row=kind==="browser"
      ?this.db.prepare("SELECT envelope FROM website_logins WHERE owner=? AND origin=?").get(owner,target)
      :this.db.prepare("SELECT envelope FROM console_logins WHERE owner=? AND target=?").get(owner,target);
    return row?unseal(this.key,owner,this.id(kind,target),(row as {envelope:string}).envelope) as Record<string,unknown>:null;
  }
  save(owner:string,chat:string,kind:CredentialKind,target:string,password:string,persist:boolean,label=target,extra:Record<string,unknown>={}){
    if(!password||password.length>4096)throw Error("Invalid password");
    return this.saveValues(owner,chat,kind,target,{...extra,password},persist,label);
  }
  saveValues(owner:string,chat:string,kind:CredentialKind,target:string,payload:Record<string,unknown>,persist:boolean,label=target){
    const fields=kind==="console"?["password"]:["password","username","email"];
    if(!fields.some(field=>typeof payload[field]==="string"&&payload[field])||Object.entries(payload).some(([field,value])=>!fields.includes(field)||typeof value!=="string"||!value||value.length>4096))throw Error("Invalid credentials");
    const effective=this.get(owner,chat,kind,target);
    const changedIdentity=(previous:Record<string,unknown>|null)=>kind==="browser"&&!payload.password&&["username","email"].some(field=>payload[field]!==undefined&&payload[field]!==previous?.[field]);
    const changedForChat=changedIdentity(effective);
    const binding=kind==="browser"&&payload.password?this.identityBinding({...effective,...payload}):undefined;
    if(persist){
      const previous=this.permanent(owner,kind,target),next={...previous,...payload};
      if(changedIdentity(previous)&&previous?.passwordIdentityBinding!==this.identityBinding(next)){delete next.password;delete next.passwordIdentityBinding;}
      if(binding)next.passwordIdentityBinding=binding;
      const envelope=seal(this.key,owner,this.id(kind,target),next);
      if(kind==="browser")this.db.prepare("INSERT INTO website_logins VALUES(?,?,?) ON CONFLICT(owner,origin) DO UPDATE SET envelope=excluded.envelope").run(owner,target,envelope);
      else this.db.prepare("INSERT INTO console_logins VALUES(?,?,?,?) ON CONFLICT(owner,target) DO UPDATE SET label=excluded.label,envelope=excluded.envelope").run(owner,target,label,envelope);
      const slot=this.slot(owner,chat,kind,target),temporary=this.temporary.get(slot);
      if(temporary){
        const remaining=unseal(this.key,owner,this.id(kind,target,chat),temporary.envelope) as Record<string,unknown>;
        for(const field of Object.keys(payload))delete remaining[field];
        if(changedForChat)delete remaining.password;
        if(!Object.hasOwn(remaining,"password"))delete remaining.passwordIdentityBinding;
        if(Object.keys(remaining).length)temporary.envelope=seal(this.key,owner,this.id(kind,target,chat),remaining);
        else this.temporary.delete(slot);
      }
    }else{
      const slot=this.slot(owner,chat,kind,target);
      if(!this.temporary.has(slot)&&this.temporary.size>=256)throw Error("Temporary credential limit reached");
      const old=this.temporary.get(slot);
      const previous=old&&old.expires>Date.now()?unseal(this.key,owner,this.id(kind,target,chat),old.envelope) as Record<string,unknown>:{};
      this.temporary.set(slot,{owner,chat,kind,target,envelope:seal(this.key,owner,this.id(kind,target,chat),{...previous,...payload,...(binding?{passwordIdentityBinding:binding}:{}),...(changedForChat?{password:null}:{})}),expires:Date.now()+24*60*60_000});
    }
  }
  forgetChat(owner:string,chat:string){for(const [id,item]of this.temporary)if(item.owner===owner&&item.chat===chat)this.temporary.delete(id);}
  clearTemporary(owner:string,kind:CredentialKind,target:string){for(const[id,item]of this.temporary)if(item.owner===owner&&item.kind===kind&&item.target===target)this.temporary.delete(id);}
  delete(owner:string,kind:CredentialKind,target:string){
    if(kind==="browser")this.db.prepare("DELETE FROM website_logins WHERE owner=? AND origin=?").run(owner,target);
    else this.db.prepare("DELETE FROM console_logins WHERE owner=? AND target=?").run(owner,target);
    this.clearTemporary(owner,kind,target);
  }
  list(owner:string){return [
    ...this.db.prepare("SELECT origin FROM website_logins WHERE owner=? ORDER BY origin").all(owner),
    ...this.db.prepare("SELECT target AS origin,label,'console' AS kind FROM console_logins WHERE owner=? ORDER BY label").all(owner),
  ];}
  clear(){this.temporary.clear();}
}
