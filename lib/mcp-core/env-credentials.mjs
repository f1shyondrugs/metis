import {createHash} from 'node:crypto';
import {seal,unseal} from '../../services/browser-login/credential-envelope.mjs';

const prefix='metis-mcp-env:v1:';
export function mcpTargetBinding(entry) {
  return createHash('sha256').update(JSON.stringify([entry.id,entry.ownerId,entry.kind,entry.command??null,entry.args??[],entry.cwd??null,entry.url??null])).digest('hex');
}
function key() {
  const raw=process.env.AI_CHAT_SECRETS_KEY?.trim()||'';
  const result=Buffer.from(raw,/^[a-f0-9]{64}$/i.test(raw)?'hex':'base64');
  if(result.length!==32)throw Error('MCP credential encryption is not configured.');
  return result;
}
export function validEnvName(name) {
  return typeof name==='string'&&/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name)&&!['__proto__','prototype','constructor'].includes(name);
}
export function encryptMcpEnv(entry, values) {
  if(!entry.ownerId)throw Error('An account-owned MCP connection is required.');
  const master=key();
  try {
    return Object.fromEntries(Object.entries(values).map(([name,value])=>{
      if(!validEnvName(name)||typeof value!=='string'||value.length>16384||value.includes('\0'))throw Error('Invalid MCP environment values.');
      return [name,prefix+seal(master,entry.ownerId,JSON.stringify(['mcp-env',mcpTargetBinding(entry),name]),{value})];
    }));
  } finally {master.fill(0);}
}
export function resolveMcpEnv(entry) {
  return Object.fromEntries(Object.entries(entry.env||{}).map(([name,value])=>{
    if(typeof value!=='string'||!value.startsWith(prefix))return [name,value];
    const master=key();
    try {
      const decoded=unseal(master,entry.ownerId,JSON.stringify(['mcp-env',mcpTargetBinding(entry),name]),value.slice(prefix.length));
      if(typeof decoded.value!=='string')throw Error();
      return [name,decoded.value];
    } catch {throw Error('MCP credentials cannot be decrypted for this connection. Enter them again in protected settings.');}
    finally {master.fill(0);}
  }));
}
// Freeze the effective values of legacy placeholder-backed credentials on migration.
// Newly submitted and already encrypted values remain exact literal strings.
export function preservedMcpEnv(entry) {
  return Object.fromEntries(Object.entries(resolveMcpEnv(entry)).map(([name,value])=>[name,
    String(entry.env[name]).startsWith(prefix)?value:String(value).replace(/\$\{([A-Z0-9_]+)\}/g,(_,key)=>process.env[key]||'')]));
}
export function mcpEnvMetadata(entry) {
  return Object.keys(entry.env||{}).map(name=>({name,configured:true,encrypted:typeof entry.env[name]==='string'&&entry.env[name].startsWith(prefix)}));
}
