import { z } from "zod";

export const vaultFieldTypes = ["url", "text", "login_id", "secret"] as const;
export const vaultFieldTypeSchema = z.enum(vaultFieldTypes);
const name = z.string().trim().min(1).max(64).regex(/^[\p{L}][\p{L}\p{N}_-]*$/u);
const title = z.string().trim().min(1).max(120).regex(/^[^\x00-\x1f\x7f]+$/);
const id = z.string().uuid();
const revision = z.number().int().positive();

const field = z.object({
  id: id.optional(),
  name,
  type: vaultFieldTypeSchema,
  value: z.string().min(1).max(4096).optional(),
}).strict();

const fields = z.array(field).max(20).superRefine((items, context) => {
  const names = new Set<string>(), ids = new Set<string>();
  for (const [index,item] of items.entries()) {
    const key = item.name.normalize("NFKC").toLowerCase();
    if (names.has(key)) context.addIssue({code:"custom",path:[index,"name"],message:"Field names must be unique."});
    if (item.id && ids.has(item.id)) context.addIssue({code:"custom",path:[index,"id"],message:"Field IDs must be unique."});
    names.add(key);
    if (item.id) ids.add(item.id);
    if (item.type === "url" && item.value !== undefined) {
      let valid = false;
      try {
        const url = new URL(item.value);
        valid = ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
      } catch {}
      if (!valid) context.addIssue({code:"custom",path:[index,"value"],message:"Use a URL without credentials."});
    }
  }
  if (items.reduce((size,item)=>size+(item.value?.length ?? 0),0)>16_000)
    context.addIssue({code:"custom",message:"Combined values are too large."});
});

export const namedVaultMutation = z.discriminatedUnion("action", [
  z.object({action:z.literal("create"),title,fields}).strict(),
  z.object({action:z.literal("update"),id,revision,title,fields}).strict(),
  z.object({action:z.literal("delete"),id,revision}).strict(),
]);

export type NamedVaultMutation = z.infer<typeof namedVaultMutation>;
export type VaultFieldType = z.infer<typeof vaultFieldTypeSchema>;
export type VaultFieldSummary = { id:string; name:string; type:VaultFieldType };
export type NamedVaultSummary = {
  id:string; title:string; kind:"browser"|"console"|"custom"; revision:number; fields:VaultFieldSummary[];
};

export const namedVaultSummarySchema = z.object({
  id, title, kind:z.enum(["browser","console","custom"]), revision,
  fields:z.array(z.object({id,name,type:vaultFieldTypeSchema}).strict()).max(20),
}).strict();
