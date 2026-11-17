import {getAuthenticatedUserId} from "@/lib/auth";
import {requestOriginAllowed} from "@/lib/request-network";
import {ConversionError,convertDocument} from "@/lib/document-conversion";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"private, no-store"}});
export async function POST(req:Request){
 const userId=await getAuthenticatedUserId(req);
 if(!userId)return json({error:"Unauthorized"},401);
 if(!requestOriginAllowed(req))return json({error:"Invalid origin"},403);
 let body:unknown;try{body=await req.json();}catch{return json({error:"Invalid request"},400);}
 try{return json(convertDocument(body,userId));}
 catch(error){return json({error:error instanceof ConversionError?error.message:"Could not convert document."},error instanceof ConversionError?error.status:500);}
}
