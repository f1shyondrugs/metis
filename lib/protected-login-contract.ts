import {z} from "zod";

export const protectedInputSchema = z.object({
  requestId: z.string(),
  origin: z.string(),
  expiresAt: z.string(),
  kind: z.literal("console").optional(),
  sessionId: z.string().optional(),
  fields: z.array(z.enum(["password", "username", "email"])).optional(),
});

const formControlSchema = z.object({
  index:z.number(), tag:z.string(), id:z.string(), label:z.string(), visible:z.boolean(),
  selector:z.string(), type:z.string().optional(), name:z.string().optional(), value:z.string().optional(),
  options:z.array(z.object({value:z.string(),text:z.string(),selected:z.boolean(),disabled:z.boolean()})).optional(),
});
const formSchema=z.object({text:z.string(),controls:z.array(formControlSchema)});
export type ProtectedFormControl=z.infer<typeof formControlSchema>;

const replySchema = z.object({
  url:z.string().optional(),
  tabs:z.array(z.object({id:z.string(),url:z.string(),title:z.string()})).optional(),
  missingFields:z.array(z.enum(["password","username","email"])).optional(),
  credentials:z.array(z.object({origin:z.string()}).passthrough()).optional(),
  status: z.string().optional(),
  origin: z.string().optional(),
  sessionId: z.string().optional(),
  target: z.string().optional(),
  label: z.string().optional(),
  secureInput: protectedInputSchema.optional(),
  filled: z.boolean().optional(),
  scope: z.enum(["permanent", "chat"]).optional(),
  snapshot: z.string().optional(),
  form: formSchema.optional(),
}).passthrough();

export type ProtectedLoginReply = z.infer<typeof replySchema>;

export function parseProtectedLoginReply(value: unknown): ProtectedLoginReply {
  return replySchema.parse(value);
}

export function requireProtectedForm(reply: ProtectedLoginReply) {
  return formSchema.parse(reply.form);
}

export function requireProtectedInput(reply: ProtectedLoginReply) {
  return protectedInputSchema.parse(reply.secureInput);
}
