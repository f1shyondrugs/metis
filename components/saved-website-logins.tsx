"use client";
import { useEffect,useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
export function SavedWebsiteLogins(){
  const [sites,setSites]=useState<Array<{origin:string;kind?:"console";label?:string}>>([]),[error,setError]=useState(""),[editing,setEditing]=useState(""),[password,setPassword]=useState(""),[busy,setBusy]=useState(false);
  const [username,setUsername]=useState(""),[email,setEmail]=useState("");
  const clear=()=>{setPassword("");setUsername("");setEmail("");};
  async function refresh(){try{const response=await fetch("/api/browser/saved-logins",{cache:"no-store"});if(!response.ok)throw Error("Protected credential service unavailable.");setSites((await response.json()).credentials);setError("");}catch(e){setError((e as Error).message);}}
  useEffect(()=>{void refresh();},[]);
  async function mutate(action:"delete"|"update",origin:string){
    setBusy(true);setError("");
    try{const response=await fetch("/api/browser/saved-logins",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,origin,kind:sites.find(site=>site.origin===origin)?.kind||"browser",...(action==="update"?{...(password?{password}:{}),...(username?{username}:{}),...(email?{email}:{})}:{})})});if(!response.ok)throw Error("Update failed.");setEditing("");await refresh();}catch(e){setError((e as Error).message);}finally{clear();setBusy(false);}
  }
  return <section className="space-y-4"><h2 className="text-lg font-semibold">Saved logins</h2>
    <p className="text-sm text-muted-foreground">Choose Save permanently in the login form to save an entry here. Otherwise it stays in the current chat until service restart. Console entries also bind to the host, account and authentication method.</p>
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    {!sites.length&&!error&&<p className="text-sm text-muted-foreground">No saved logins.</p>}
    {sites.map(site=><article key={site.origin} className="space-y-3 rounded-lg border p-4"><p className="break-all font-medium">{site.label||site.origin}</p>
      {editing===site.origin?<form onSubmit={e=>{e.preventDefault();void mutate("update",site.origin);}} className="space-y-3">
        {site.kind!=="console"&&<><label className="block text-sm">New username<Input value={username} maxLength={512} autoComplete="off" disabled={busy} onChange={e=>setUsername(e.target.value)}/></label><label className="block text-sm">New email<Input type="email" value={email} maxLength={320} autoComplete="off" disabled={busy} onChange={e=>setEmail(e.target.value)}/></label></>}
        <label className="block text-sm">New password<Input type="password" autoComplete="new-password" required={site.kind==="console"} value={password} maxLength={4096} disabled={busy} onChange={e=>setPassword(e.target.value)}/></label>
        <p className="text-xs text-muted-foreground">Blank fields keep their current values. Changing the username or email requires a new password.</p><Button disabled={busy||!password&&!username&&!email}>Save</Button><Button type="button" variant="outline" onClick={()=>{setEditing("");clear();}}>Cancel</Button></form>:<div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={()=>{setEditing(site.origin);clear();}}>Edit login</Button><Button variant="destructive" disabled={busy} onClick={()=>void mutate("delete",site.origin)}>Delete</Button></div>}
    </article>)}
  </section>;
}
