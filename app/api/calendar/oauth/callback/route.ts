import {getAuthenticatedUserId} from "@/lib/auth";
import {finishCalendarOAuth} from "@/lib/calendar/oauth";
import {config} from "@/lib/config";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(req:Request){
 const owner=await getAuthenticatedUserId(req),url=new URL(req.url),back=new URL("/?c=calendar",config.publicUrl);
 if(!owner||url.searchParams.has("error")){back.searchParams.set("calendar_auth","rejected");return Response.redirect(back,303);}
 try{await finishCalendarOAuth(owner,url.searchParams.get("state")||"",url.searchParams.get("code")||"");back.searchParams.set("calendar_auth","connected");}
 catch{back.searchParams.set("calendar_auth","failed");}
 return new Response(null,{status:303,headers:{Location:back.href,"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
}
