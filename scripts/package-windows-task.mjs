// Task Scheduler is the independent parent: taskkill /T on the old app must not
// terminate its updater. No saved password, different account or implicit UAC.
import path from "node:path";
import {randomUUID} from "node:crypto";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
const execute=promisify(execFile);
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
export function scheduledUpdateScript({command,args,logFile,installRoot,packageUpdate,taskName}){
  if(!/^MetisUpdate-[a-f0-9-]{36}$/.test(taskName))throw Error("Invalid updater task name");
  const invocation=[command,...args];
  const environment=packageUpdate?". "+quote(path.join(installRoot,"run-service.ps1"))+" '--metis-load-env-only'\n$ErrorActionPreference='Continue'\n$env:NODE_ENV='production'":"";
  const body=`$ErrorActionPreference='Continue'
$code=1
try {
  [IO.File]::AppendAllText(${quote(logFile)},("[metis-update-pid:"+$PID+"]"+[Environment]::NewLine))
  ${environment}
  & ${invocation.map(quote).join(" ")} 2>&1 | ForEach-Object {
    [IO.File]::AppendAllText(${quote(logFile)},($_.ToString()+[Environment]::NewLine),[Text.UTF8Encoding]::new($false))
  }
  if($null -ne $LASTEXITCODE){$code=$LASTEXITCODE}
} catch { $code=1 }
finally {
  [IO.File]::AppendAllText(${quote(logFile)},([Environment]::NewLine+"[metis-update-exit:"+$code+"]"+[Environment]::NewLine))
  Unregister-ScheduledTask -TaskName ${quote(taskName)} -Confirm:$false -ErrorAction SilentlyContinue
}
exit $code`;
  const encoded=Buffer.from(body,"utf16le").toString("base64");
  return `$ErrorActionPreference='Stop'
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$sid=$identity.User.Value
$elevated=([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$level=if($elevated){'Highest'}else{'Limited'}
$serviceAccount=$sid -in @('S-1-5-18','S-1-5-19','S-1-5-20')
if(!$serviceAccount -and [Diagnostics.Process]::GetCurrentProcess().SessionId -eq 0){
  throw 'A non-interactive Windows service requires an operator-managed update task; no account or rights were changed.'
}
$logon=if($serviceAccount){'ServiceAccount'}else{'Interactive'}
$principal=New-ScheduledTaskPrincipal -UserId $sid -LogonType $logon -RunLevel $level
$action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ${quote("-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand "+encoded)}
$settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName ${quote(taskName)} -Action $action -Principal $principal -Settings $settings | Out-Null
try { Start-ScheduledTask -TaskName ${quote(taskName)} }
catch { Unregister-ScheduledTask -TaskName ${quote(taskName)} -Confirm:$false -ErrorAction SilentlyContinue;throw }
`;
}
export async function launchWindowsUpdateTask(input,{run=execute}={}){
  const taskName="MetisUpdate-"+randomUUID();
  const script=scheduledUpdateScript({...input,taskName});
  await run("powershell.exe",["-NoProfile","-NonInteractive","-EncodedCommand",Buffer.from(script,"utf16le").toString("base64")],{timeout:30000,windowsHide:true,maxBuffer:65536});
  return taskName;
}
