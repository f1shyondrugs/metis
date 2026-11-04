import {closeSync,constants,createReadStream,createWriteStream,fchmodSync,fstatSync,mkdirSync,openSync,readSync,renameSync,unlinkSync,writeFileSync,writeSync} from "node:fs";
import {copyFile} from "node:fs/promises";
import {pipeline} from "node:stream/promises";
import {randomUUID} from "node:crypto";
import path from "node:path";

function partsOf(value:string,allowRoot=false) {
  if(typeof value!=="string"||!path.isAbsolute(value)||value.includes("\0"))throw Error("An absolute file path is required");
  const segments=value.split(process.platform==="win32"?/[\\/]/:/\//);
  if(segments.some(segment=>segment===".."||segment==="."))throw Error("Non-canonical file path");
  const parts=segments.slice(1);
  if(process.platform==="linux"&&!(allowRoot&&value==="/")&&(!parts.length||parts.some(segment=>!segment)))throw Error("Non-canonical file path");
  return value==="/"?[]:parts;
}

function pinDirectory(parts:string[],create=false,mode=0o700) {
  const flags=constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW;
  let current=openSync("/",flags);
  try {
    for(const segment of parts){
      const entry=`/proc/self/fd/${current}/${segment}`;
      let next:number;
      try{next=openSync(entry,flags);}catch(error){
        if(!create||(error as NodeJS.ErrnoException).code!=="ENOENT")throw error;
        try{mkdirSync(entry,{mode});}catch(mkdirError){if((mkdirError as NodeJS.ErrnoException).code!=="EEXIST")throw mkdirError;}
        next=openSync(entry,flags);
      }
      const previous=current;current=next;closeSync(previous);
    }
    return current;
  }catch(error){closeSync(current);throw error;}
}

function regular(fd:number) {
  try {if(!fstatSync(fd).isFile())throw Error("A regular file is required");return fd;}
  catch(error){closeSync(fd);throw error;}
}

/** The caller still owns the account/root authorization decision.
 * Linux pins every directory inode and never follows a user-controlled link.
 * Other platforms receive a best-effort final-component check, not OS proof.
 */
export function openSafeRead(file:string):number {
  const parts=partsOf(file);
  const readFlags=constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0);
  if(process.platform!=="linux")return regular(openSync(file,readFlags));
  const parent=pinDirectory(parts.slice(0,-1));
  try {
    return regular(openSync(`/proc/self/fd/${parent}/${parts[parts.length-1]}`,readFlags));
  }finally{closeSync(parent);}
}

/** Create directories without traversing symlinks; authorization remains the caller's responsibility. */
export function ensureSafeDirectory(directory:string,options:{mode?:number}={}):void {
  const parts=partsOf(directory,true);
  const mode=options.mode??0o700;
  if(process.platform!=="linux"){mkdirSync(directory,{recursive:true,mode});return;}
  closeSync(pinDirectory(parts,true,mode));
}

/** Caller closes the descriptor; Linux pins the complete directory walk. */
export function openSafeDirectory(directory:string):number {
  const parts=partsOf(directory,true);
  if(process.platform==="linux")return pinDirectory(parts);
  const fd=openSync(directory,constants.O_RDONLY|(constants.O_DIRECTORY??0)|(constants.O_NOFOLLOW??0));
  try{if(!fstatSync(fd).isDirectory())throw Error("A directory is required");return fd;}
  catch(error){closeSync(fd);throw error;}
}

/** Linux uses a pinned parent and replaces the final directory entry, never its symlink target.
 * Exclusive writes instead create the final entry with O_EXCL, rejecting any existing entry.
 * Other platforms provide best-effort final-component protection only.
 */
export function writeSafeFile(file:string,data:string|Buffer|((fd:number)=>void),options:{exclusive?:boolean;mode?:number}={}):void {
  const parts=partsOf(file);
  const parent=process.platform==="linux"?pinDirectory(parts.slice(0,-1)):undefined;
  const directory=parent===undefined?path.dirname(file):`/proc/self/fd/${parent}`;
  const target=path.join(directory,parts[parts.length-1]);
  const temporary=options.exclusive?target:path.join(directory,`.metis-${randomUUID()}.tmp`);
  const mode=options.mode??0o600;
  let fd:number|undefined,created=false,completed=false;
  try {
    fd=openSync(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW??0),mode);created=true;
    fchmodSync(fd,mode);if(typeof data==="function")data(fd);else writeFileSync(fd,data);closeSync(fd);fd=undefined;
    if(!options.exclusive)renameSync(temporary,target);
    completed=true;
  }finally{
    if(fd!==undefined)closeSync(fd);
    if(created&&!completed)try{unlinkSync(temporary);}catch{/* Preserve the original write error. */}
    if(parent!==undefined)closeSync(parent);
  }
}

export function readSafeFile(file:string,maxBytes=32*1024*1024):Buffer {
  const fd=openSafeRead(file);
  try{const chunks:Buffer[]=[];let total=0;
    while(true){const chunk=Buffer.allocUnsafe(Math.min(64*1024,maxBytes-total+1));const bytes=readSync(fd,chunk,0,chunk.length,null);if(!bytes)return Buffer.concat(chunks,total);total+=bytes;if(total>maxBytes)throw Error("File too large");chunks.push(chunk.subarray(0,bytes));}
  }finally{closeSync(fd);}
}

export function copySafeFile(source:string,target:string,options:{exclusive?:boolean;mode?:number}={}){
  const sourceFd=openSafeRead(source);try{writeSafeFile(target,targetFd=>{
    const buffer=Buffer.allocUnsafe(64*1024);let bytes:number;
    while((bytes=readSync(sourceFd,buffer,0,buffer.length,null))>0){let offset=0;while(offset<bytes)offset+=writeSync(targetFd,buffer,offset,bytes-offset);}
  },options);}finally{closeSync(sourceFd);}
}

/** Copy asynchronously without reopening an untrusted source or destination path. */
export async function copySafeFileAsync(source:string,target:string,options:{mode?:number}={}):Promise<number> {
  const sourceFd=openSafeRead(source);
  let parent:number|undefined,targetFd:number|undefined,created=false,completed=false;
  let entry=target;
  try {
    const parts=partsOf(target);
    if(process.platform==="linux"){
      parent=pinDirectory(parts.slice(0,-1));
      entry=`/proc/self/fd/${parent}/${parts.at(-1)}`;
    }
    targetFd=openSync(entry,constants.O_RDWR|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW??0),options.mode??0o600);
    created=true;
    fchmodSync(targetFd,options.mode??0o600);
    if(process.platform==="linux"){
      // Both proc paths refer to already-authorized inodes, even if an agent
      // renames their directory entries while the asynchronous copy runs.
      await copyFile(`/proc/self/fd/${sourceFd}`,`/proc/self/fd/${targetFd}`);
    }else{
      await pipeline(createReadStream(source,{fd:sourceFd,autoClose:false}),createWriteStream(target,{fd:targetFd,autoClose:false}));
    }
    // copyFile may inherit source permissions; keep the destination contract.
    fchmodSync(targetFd,options.mode??0o600);
    const size=fstatSync(targetFd).size;
    completed=true;
    return size;
  }finally{
    if(targetFd!==undefined)closeSync(targetFd);
    closeSync(sourceFd);
    if(created&&!completed)try{unlinkSync(entry);}catch{/* Preserve the copy error. */}
    if(parent!==undefined)closeSync(parent);
  }
}

export function unlinkSafeFile(file:string){
  const parts=partsOf(file),parent=process.platform==="linux"?pinDirectory(parts.slice(0,-1)):undefined;
  try{unlinkSync(parent===undefined?file:`/proc/self/fd/${parent}/${parts.at(-1)}`);}finally{if(parent!==undefined)closeSync(parent);}
}
