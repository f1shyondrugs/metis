import {passkeyRequest} from "@/lib/passkeys";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(req:Request,context:{params:Promise<{action:string[]}>}){
 const {action}=await context.params;
 return passkeyRequest(req,action.join("/"));
}
