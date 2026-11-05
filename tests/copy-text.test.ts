import assert from "node:assert/strict";
import test from "node:test";
import {copyText} from "../lib/copy-text";
function replaceGlobal(name:string,value:unknown){
 const previous=Object.getOwnPropertyDescriptor(globalThis,name);
 Object.defineProperty(globalThis,name,{configurable:true,value});
 return()=>{if(previous)Object.defineProperty(globalThis,name,previous);else Reflect.deleteProperty(globalThis,name);};
}

test("clipboard API success copies exact text without creating a selection fallback",async t=>{
 const written:string[]=[];
 t.after(replaceGlobal("navigator",{clipboard:{writeText:async(text:string)=>{written.push(text);}}}));
 await copyText("https://example.org/share/notes/token");
 assert.deepEqual(written,["https://example.org/share/notes/token"]);
});
test("denied async clipboard uses the existing modal input and restores focus",async t=>{
 const events:string[]=[];
 t.after(replaceGlobal("navigator",{clipboard:{writeText:async()=>{throw new Error("Denied");}}}));
 t.after(replaceGlobal("document",{activeElement:{focus:()=>events.push("restore")},execCommand:(command:string)=>{events.push(command);return true;}}));
 const field={value:"share link",focus:()=>events.push("focus"),select:()=>events.push("select")} as unknown as HTMLInputElement;
 await copyText("share link",field);
 assert.deepEqual(events,["focus","select","copy","restore"]);
});
