import {z} from "zod";

const account=z.string().regex(/^[a-z_][a-z0-9_.-]{0,63}$/);
export const consoleConnectionSchema=z.discriminatedUnion("method",[
  z.object({method:z.literal("ssh"),host:z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9.:-]{0,252}$/).transform(value=>value.toLowerCase()),port:z.number().int().min(1).max(65535).default(22),user:account}).strict(),
  z.object({method:z.enum(["su","sudo"]),user:account}).strict(),
]);
export type ConsoleConnection=z.infer<typeof consoleConnectionSchema>;
export type SavedLogin={origin:string;kind?:"browser"|"console";label?:string};

export function consoleTargetInfo(target:string){
  try{
    const [method,host,port,authUser,user,fingerprint]=z.tuple([
      z.enum(["ssh","su","sudo"]),z.string().min(1).max(253),
      z.number().int().min(0).max(65535),account,account,z.string().min(1).max(256),
    ]).parse(JSON.parse(target));
    if(method==="ssh"){
      const connection=consoleConnectionSchema.parse({method,host,port,user});
      if(authUser!==user||!fingerprint.startsWith("SHA256:"))return null;
      return {type:"ssh" as const,connection,host,authUser,fingerprint};
    }
    if(port!==0||fingerprint!=="local"||method==="su"&&authUser!==user)return null;
    return {type:"local" as const,connection:consoleConnectionSchema.parse({method,user}),host,authUser,fingerprint};
  }catch{return null;}
}

/** Only routing metadata crosses into agent context; never read credential envelopes. */
export function savedLoginSummaries(entries:SavedLogin[]){
  return entries.flatMap(entry=>{
    if(entry.kind==="console"){
      const info=consoleTargetInfo(entry.origin);
      return info?[{kind:"console",origin:entry.origin,...info,usage:"console_connect"}]:[];
    }
    try{
      const url=new URL(entry.origin);
      if(url.protocol!=="https:"||url.username||url.password||url.port)return [];
      return [{kind:"browser",origin:url.origin,type:"website",usage:"browser_request_login"}];
    }catch{return [];}
  });
}
