import {unified} from "unified";
import remarkParse from "remark-parse";
import remarkMath from "remark-math";

type MathTree = {
 type?:string;value?:string;children?:MathTree[];data?:{hChildren?:MathTree[]};
 position?:{start:{offset?:number};end:{offset?:number}};
};
const mathParser=unified().use(remarkParse).use(remarkMath);
const separator=/^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)+\|?[ \t]*\r?$/;

/** Use the Markdown parser's math/text ranges before GFM splits table pipes.
 * The one-code-unit marker keeps original editor source positions unchanged. */
export function protectMathTablePipes(source:string):{source:string;marker?:string}{
 if(!source.includes("|"))return {source};
 const lines=source.split("\n"),rows=new Set<number>();
 for(let i=1;i<lines.length;i++)if(separator.test(lines[i])&&lines[i-1].includes("|")){
  rows.add(i-1);
  for(let j=i+1;j<lines.length&&lines[j].trim()&&lines[j].includes("|");j++)rows.add(j);
 }
 if(!rows.size)return {source};
 const starts:number[]=[];let offset=0;
 for(const line of lines){starts.push(offset);offset+=line.length+1;}
 const protectedPipes=new Set<number>();
 const visit=(node:MathTree)=>{
  const start=node.position?.start.offset,end=node.position?.end.offset;
  if(start!==undefined&&end!==undefined){
   if(node.type==="inlineMath"){
    const raw=source.slice(start,end);
    if(!raw.includes("\n"))for(let i=start;i<end;i++)if(source[i]==="|")protectedPipes.add(i);
   }else if(node.type==="text"){
    const raw=source.slice(start,end);
    for(const point of raw.matchAll(/\([+-]?(?:\d+(?:[.,]\d+)?|[A-Za-z](?:_\d+)?)\s*\|\s*[+-]?(?:\d+(?:[.,]\d+)?|[A-Za-z](?:_\d+)?)\)/g)){
     protectedPipes.add(start+point.index+point[0].indexOf("|"));
    }
   }
  }
  for(const child of node.children||[])visit(child);
 };
 visit(mathParser.parse(source) as MathTree);
 if(!protectedPipes.size)return {source};
 let code=0xe000;
 while(code<=0xf8ff&&source.includes(String.fromCharCode(code)))code++;
 if(code>0xf8ff)return {source};
 const marker=String.fromCharCode(code);
 let changed=false;
 for(const row of rows){
  const chars=lines[row].split("");
  for(let i=0;i<chars.length;i++)if(chars[i]==="|"&&protectedPipes.has(starts[row]+i)){
   // Already escaped Markdown pipes do not need shielding.
   let slashes=0,j=i;while(j>0&&chars[--j]==="\\")slashes++;
   if(slashes%2===0){chars[i]=marker;changed=true;}
  }
  lines[row]=chars.join("");
 }
 return changed?{source:lines.join("\n"),marker}:{source};
}

/** Restore mdast values and remark-math's prebuilt HTML text children. */
export function restoreMathTablePipes(tree:MathTree,marker?:string):void{
 if(!marker)return;
 const visit=(node:MathTree)=>{
  if(typeof node.value==="string")node.value=node.value.split(marker).join("|");
  for(const child of node.children||[])visit(child);
  if(node.type==="math"||node.type==="inlineMath")for(const child of node.data?.hChildren||[])visit(child);
 };
 visit(tree);
}
export function remarkMathTablePipes(options:{marker?:string}){
 return (tree:MathTree)=>restoreMathTablePipes(tree,options.marker);
}
