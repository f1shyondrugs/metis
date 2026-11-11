export type McpCredentialEntry = {id:string;ownerId?:string;kind?:string;command?:string;args?:string[];cwd?:string;url?:string;env?:Record<string,string>;[key:string]:unknown};
export function mcpTargetBinding(entry:McpCredentialEntry):string;
export function validEnvName(name:unknown):boolean;
export function encryptMcpEnv(entry:McpCredentialEntry,values:Record<string,string>):Record<string,string>;
export function resolveMcpEnv(entry:McpCredentialEntry):Record<string,string>;
export function preservedMcpEnv(entry:McpCredentialEntry):Record<string,string>;
export function mcpEnvMetadata(entry:McpCredentialEntry):Array<{name:string;configured:boolean;encrypted:boolean}>;
