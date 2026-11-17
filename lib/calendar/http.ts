import {z} from "zod";
import {CalendarError} from "./types";
export const calendarResponse=(data:unknown,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"private, no-store"}});
export function calendarFailure(error:unknown){return calendarResponse({error:error instanceof CalendarError?error.message:"Calendar request failed. Your events are retained.",code:error instanceof CalendarError?error.code:"calendar_error"},error instanceof CalendarError?error.status:error instanceof z.ZodError||error instanceof SyntaxError?400:500);}
export async function calendarBody(req:Request,limit:number){
 if(Number(req.headers.get("content-length")||0)>limit)throw new CalendarError("Request too large.",413);
 if(!req.body)throw new CalendarError("A JSON request is required.");
 const reader=req.body.getReader(),parts:Uint8Array[]=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new CalendarError("Request too large.",413);}parts.push(value);}}finally{reader.releaseLock();}
 const data=JSON.parse(Buffer.concat(parts).toString("utf8"));if(!data||typeof data!=="object"||Array.isArray(data))throw new CalendarError("A JSON object is required.");return data;
}
