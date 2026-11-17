import fs from "node:fs";
import path from "node:path";
import {spawn,execFile} from "node:child_process";
import {promisify} from "node:util";
const execute=promisify(execFile);
export function startDetachedProcess(command,args,options={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{...options,detached:true,stdio:"ignore",windowsHide:true});
    child.once("error",reject);
    child.once("spawn",()=>{child.unref();resolve(child);});
  });
}
export function windowsStopProbe(root,pid=process.pid){
  const quote=value=>"'"+value.replaceAll("'","''")+"'";
  return [
    "$ErrorActionPreference='Stop'",
    "$root="+quote(root),
    "$hostExe="+quote(path.join(root,"MetisHost.exe")),
    "$count=@(Get-CimInstance Win32_Process | Where-Object {",
    "$_.ProcessId -ne "+pid+" -and $_.ProcessId -ne $PID -and (",
    "($_.ExecutablePath -ieq $hostExe) -or (",
    "$_.Name -ieq 'node.exe' -and $_.CommandLine -and",
    "$_.CommandLine.IndexOf($root+'\\',[StringComparison]::OrdinalIgnoreCase) -ge 0 -and",
    "$_.CommandLine -match '(windows-script-host[.]mjs|run-installed-service[.]cjs|server[.]mjs|worker[.]ts|gateway-core[.]mjs)'))",
    "})",
    "Write-Output $count.Count",
  ].join(";").replaceAll("{;","{").replaceAll("(;","(").replaceAll(";})","})").replaceAll(" -and;"," -and ").replaceAll(" -or (;"," -or (");
}
export async function windowsHostOperation(root,action,{node=process.execPath,run=execute,timeout=20000,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
  const compiled=path.join(root,"MetisHost.exe"),script=path.join(root,"windows-script-host.mjs");
  const executable=fs.existsSync(compiled)?compiled:node;
  const base=executable===compiled?[]:[script];
  if(action==="start"){
    // A GUI host runs for the whole session. Await spawn, never its eventual exit.
    await startDetachedProcess(executable,base,{cwd:root,env:process.env});
    return;
  }
  if(action!=="stop")throw Error("Unsupported Windows host operation");
  await run(executable,[...base,"--stop"],{cwd:root,timeout:60000,windowsHide:true,maxBuffer:65536});
  const end=Date.now()+timeout;
  do{
    const result=await run("powershell.exe",["-NoProfile","-NonInteractive","-Command",windowsStopProbe(root)],{cwd:root,timeout:10000,windowsHide:true,maxBuffer:65536});
    if(result.stdout.trim()==="0")return;
    if(!/^\d+$/.test(result.stdout.trim()))throw Error("Windows service process visibility unavailable");
    if(Date.now()>=end)throw Error("Windows host did not finish stopping");
    await sleep(200);
  }while(true);
}
