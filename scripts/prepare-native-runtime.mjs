// Build-time only: never require/install the TypeScript compiler on the host.
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import ts from "typescript";
export function prepareNativeRuntime(root=process.cwd(),dist=process.env.NEXT_DIST_DIR||".next"){
  const source=fs.readFileSync(path.join(root,"next.config.ts"),"utf8");
  const result=ts.transpileModule(source,{fileName:"next.config.ts",reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}});
  if(result.diagnostics?.some(item=>item.category===ts.DiagnosticCategory.Error))throw Error("Could not emit the native runtime configuration");
  const output=path.join(root,dist,"runtime-next.config.mjs");
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,result.outputText);
  return output;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  prepareNativeRuntime();console.log("NATIVE_RUNTIME_CONFIG_EMITTED");
}
