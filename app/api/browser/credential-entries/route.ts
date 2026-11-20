import { getAuthenticatedUserId } from "@/lib/auth";
import { browserLoginRequest, browserLoginSameOrigin } from "@/lib/browser-login-client";
import { namedVaultMutation, namedVaultSummarySchema } from "@/lib/named-vault-contract";
import { ProtectedLoginError } from "@/lib/protected-login-errors";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control":"no-store" };

async function vaultOwner(req: Request) {
  return req.headers.get("cookie") && !req.headers.has("x-chat-password") ? getAuthenticatedUserId(req) : null;
}

export async function GET(req: Request) {
  const owner = await vaultOwner(req);
  if (!owner) return Response.json({error:"Unauthorized"},{status:401,headers});
  try {
    const result = await browserLoginRequest(owner,undefined,"named_vault_list",{},true);
    return Response.json({entries:z.array(namedVaultSummarySchema).parse(result.entries)},{headers});
  } catch {
    return Response.json({error:"Named vault entries are unavailable."},{status:503,headers});
  }
}

export async function POST(req: Request) {
  const owner = await vaultOwner(req);
  if (!owner) return Response.json({error:"Unauthorized"},{status:401,headers});
  if (!browserLoginSameOrigin(req)) return Response.json({error:"Forbidden"},{status:403,headers});
  let input:z.infer<typeof namedVaultMutation>;
  try {
    const body = await req.text();
    if (Buffer.byteLength(body)>24_000) throw Error("Too large");
    input = namedVaultMutation.parse(JSON.parse(body));
  } catch {
    return Response.json({error:"Check the entry title and fields. Names must be unique."},{status:400,headers});
  }
  try {
    const reply = await browserLoginRequest(owner,undefined,"named_vault_mutate",input,true);
    const status = z.enum(["created","updated","deleted"]).parse(reply.status);
    if (status==="deleted") return Response.json({status},{headers});
    return Response.json({status,entry:namedVaultSummarySchema.parse(reply.entry)},{headers});
  } catch(error) {
    if (error instanceof ProtectedLoginError &&
        ["credential_unavailable","credential_revision_changed","credential_bound_delete"].includes(error.code)) {
      return Response.json({error:error.message},{status:error.code==="credential_unavailable"?404:409,headers});
    }
    return Response.json({error:"Could not save the vault entry."},{status:503,headers});
  } finally {
    if ("fields" in input) for(const field of input.fields) field.value=undefined;
  }
}
