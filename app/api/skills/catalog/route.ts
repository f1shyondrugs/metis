import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { isHostAdmin } from "@/lib/user-access";
import { config } from "@/lib/config";
import { searchDirectory, knownDirectorySkill } from "@/lib/skills-directory";
import { listInstalledSkills } from "@/lib/skills";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
let installing = false;
export async function GET(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const result = await searchDirectory(new URL(req.url).searchParams.get("q") || "");
  return Response.json({ ...result, canInstall: isHostAdmin(await getAuthenticatedUserId(req)) });
}
export async function POST(req: Request) {
  if (!(await isAuthenticated(req))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!isHostAdmin(await getAuthenticatedUserId(req))) return Response.json({ error: "A host administrator must install shared skill packages." }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const key = typeof body.catalogId === "string" ? body.catalogId : body.id;
  const entry = typeof key === "string" ? knownDirectorySkill(key) : null;
  if (!entry) return Response.json({ error: "Unknown catalog skill" }, { status: 400 });
  const existing = listInstalledSkills().find(item => item.id === entry.id);
    if (existing) return existing.source === entry.source ? Response.json({ installed: entry.id }) : Response.json({ error: "A different package already uses this skill id." }, { status: 409 });
  if (installing) return Response.json({ error: "Another skill installation is running. Try again when it finishes." }, { status: 409 });
  installing = true;
  try {
    await promisify(execFile)("npx", ["--yes", "skills", "add", entry.source, "--skill", entry.id, "--agent", "universal", "--yes"], {
      cwd: config.skillRoot, timeout: 120_000, maxBuffer: 2_000_000,
      env: { ...process.env, DISABLE_TELEMETRY: "1" },
    });
    if (!listInstalledSkills().some(item => item.id === entry.id)) throw new Error("The installer did not register this skill.");
    return Response.json({ installed: entry.id });
  } catch {
    return Response.json({ error: "Could not install this skill. Check the server network and Skills CLI, then try again." }, { status: 500 });
  } finally { installing = false; }
}
