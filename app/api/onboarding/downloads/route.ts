import {getAuthenticatedUserId} from "@/lib/auth";
import {remoteDesktopDownloads} from "@/lib/remote-client-release";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:Request){
 if(!await getAuthenticatedUserId(request))return Response.json({error:"Unauthorized"},{status:401});
 const platform=new URL(request.url).searchParams.get("platform");
 if(platform==="ios"||platform==="android")return Response.json({platform,status:"development",downloads:[]},{headers:{"Cache-Control":"private, no-store"}});
 if(platform!=="windows"&&platform!=="macos"&&platform!=="linux")return Response.json({error:"Choose a supported platform."},{status:400});
 try{const downloads=await remoteDesktopDownloads(platform);return Response.json({platform,status:downloads.length?"available":"unavailable",downloads},{headers:{"Cache-Control":"private, no-store"}});}
 catch{return Response.json({error:"Could not load app downloads. Try again."},{status:503});}
}
