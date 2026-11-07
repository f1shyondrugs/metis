import {register} from "tsx/esm/api";
import {register as registerCjs} from "tsx/cjs/api";
import {fileURLToPath} from "node:url";

// One loader and module graph per worker. Explicit tsconfig keeps aliases
// independent of cwd. CJS source exports appear under default in some Node
// versions; other versions expose named exports. Never import twice to probe.
const tsconfig=fileURLToPath(new URL("../tsconfig.json",import.meta.url));
registerCjs({tsconfig});
register({tsconfig});

export async function importWorkerModule(specifier) {
  const namespace=await import(new URL(specifier,import.meta.url).href);
  return namespace.default ?? namespace;
}
