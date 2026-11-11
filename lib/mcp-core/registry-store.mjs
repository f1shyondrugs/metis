import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

// SQLite provides a cross-process lock released automatically after crashes.
// The JSON registry stays compatible with older running gateways.
export function mutateRegistry(file, mutate) {
 const lock=new DatabaseSync(path.join(path.dirname(file),'registry-lock.sqlite'));
 lock.exec('PRAGMA busy_timeout=10000; CREATE TABLE IF NOT EXISTS registry_lock(id INTEGER PRIMARY KEY)');
 let tmp;
 try {
  lock.exec('BEGIN IMMEDIATE');
  const raw=JSON.parse(fs.readFileSync(file,'utf8'));
  const servers=Array.isArray(raw)?raw:raw.servers;
  if(!Array.isArray(servers))throw Error('Invalid MCP registry.');
  const result=mutate(servers);
  tmp=file+'.'+randomUUID()+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify({version:1,servers},null,2)+'\n',{mode:0o600,flag:'wx'});
  fs.renameSync(tmp,file);tmp=undefined;
  lock.exec('COMMIT');
  return result;
 }finally{
  if(tmp)try{fs.unlinkSync(tmp);}catch{}
  lock.close();
 }
}
