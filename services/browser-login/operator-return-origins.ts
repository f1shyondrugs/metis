import fs from "node:fs";
import path from "node:path";

const MAX_CREDENTIAL_ORIGINS = 64;
const MAX_RETURN_ORIGINS = 3;
const MAX_CONFIG_BYTES = 32768;
export type OperatorReturnOrigins = Readonly<Record<string, readonly string[]>>;

function invalid(): never { throw Error("Invalid protected-login return-origin configuration"); }

function exactOrigin(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password &&
      !url.port && value === url.origin;
  } catch { return false; }
}

// Copy and freeze operator input: neither subsequent file changes nor a caller's
// mutable object may grant a running service or existing session another origin.
export function snapshotOperatorReturnOrigins(value: unknown = {}): OperatorReturnOrigins {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const entries = Object.entries(value);
  if (entries.length > MAX_CREDENTIAL_ORIGINS) invalid();
  const snapshot: Record<string, readonly string[]> = Object.create(null);
  for (const [credentialOrigin, returns] of entries) {
    if (!exactOrigin(credentialOrigin) || !Array.isArray(returns) || returns.length > MAX_RETURN_ORIGINS ||
      returns.some(origin => !exactOrigin(origin) || origin === credentialOrigin) ||
      new Set(returns).size !== returns.length) invalid();
    snapshot[credentialOrigin] = Object.freeze([...returns]);
  }
  return Object.freeze(snapshot);
}

// Production configuration is operator-owned, including every parent directory.
// Test fixtures may live under an owned temporary directory; symlinks stay denied.
export function loadOperatorReturnOrigins(file: string | undefined, testFixture = false): OperatorReturnOrigins {
  if (file === undefined) return snapshotOperatorReturnOrigins();
  if (!path.isAbsolute(file) || path.resolve(file) !== file) invalid();
  for (let current = file; ; current = path.dirname(current)) {
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || (current === file ? !stat.isFile() : !stat.isDirectory())) invalid();
    if (!testFixture && (stat.uid !== 0 || (stat.mode & 0o022))) invalid();
    if (current === path.dirname(current)) break;
  }
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_CONFIG_BYTES ||
      (testFixture ? stat.uid !== process.getuid?.() : stat.uid !== 0 || Boolean(stat.mode & 0o022))) invalid();
    const content = fs.readFileSync(fd);
    if (content.length > MAX_CONFIG_BYTES) invalid();
    return snapshotOperatorReturnOrigins(JSON.parse(content.toString("utf8")));
  } finally { fs.closeSync(fd); }
}
