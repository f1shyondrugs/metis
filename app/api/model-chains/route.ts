import { getAuthenticatedUser } from "@/lib/auth";
import { deleteModelChain, listModelChains, ModelChainError, saveModelChain } from "@/lib/model-chains";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store"};
export async function GET(req:Request) {
  const user=await getAuthenticatedUser(req);
  return user?Response.json({chains:listModelChains(user.id)},{headers}):Response.json({error:"Unauthorized"},{status:401,headers});
}
export async function PUT(req:Request) {
  const user=await getAuthenticatedUser(req);
  if(!user)return Response.json({error:"Unauthorized"},{status:401,headers});
  try {
    const text=await req.text();if(text.length>100_000)return Response.json({error:"Chain is too large."},{status:413,headers});
    const chain=saveModelChain(user.id,JSON.parse(text));
    return Response.json({chain},{headers});
  } catch(error){return Response.json({error:error instanceof Error?error.message:"Could not save chain."},{status:error instanceof ModelChainError?error.status:400,headers});}
}
export async function DELETE(req:Request) {
  const user=await getAuthenticatedUser(req);
  if(!user)return Response.json({error:"Unauthorized"},{status:401,headers});
  try {
    const {id,version}=await req.json();
    if(typeof id!=="string"||!Number.isInteger(version))throw new ModelChainError("Choose a saved chain.");
    deleteModelChain(user.id,id,version);return Response.json({ok:true},{headers});
  } catch(error){return Response.json({error:error instanceof Error?error.message:"Could not delete chain."},{status:error instanceof ModelChainError?error.status:400,headers});}
}
