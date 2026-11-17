import { getAuthenticatedUserId, isAuthenticated } from "@/lib/auth";
import { config } from "@/lib/config";
import { isHostAdmin } from "@/lib/user-access";
import {
  checkForUpdate,
  fetchCommitBySha,
  fetchReleaseByTag,
  loadLocalUpdateIdentity,
  resolveCurrentGitHead,
  resolveGithubRepo,
  type UpdateChannel,
} from "@/lib/github-releases";
import { loadReleaseManifest } from "@/lib/release-manifest";
import { buildUpdateJobRange } from "@/lib/update-history";
import { resolveUpdateJob, startInstallerUpdateJob } from "@/lib/update-job";

async function rangeForUpdate(channel: UpdateChannel, target: { tag?: string; commit?: string }) {
  const [manifest, head] = await Promise.all([
    loadReleaseManifest(config.root),
    resolveCurrentGitHead(config.root),
  ]);
  return buildUpdateJobRange({
    channel,
    currentRef: head || manifest.commit,
    currentTag: manifest.tag,
    currentVersion: manifest.version,
    currentCommit: head || manifest.commit,
    tag: target.tag,
    commit: target.commit,
  });
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 1_800;

async function requireHostAdmin(req: Request, message: string) {
  if (!(await isAuthenticated(req))) return { response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  const userId = await getAuthenticatedUserId(req);
  if (!isHostAdmin(userId)) return { response: Response.json({ error: message }, { status: 403 }) };
  return { userId };
}

export async function GET(req: Request) {
  const access = await requireHostAdmin(req, "Only host administrators can check for updates.");
  if ("response" in access) return access.response;
  try {
    const searchParams = new URL(req.url).searchParams;
    const jobId = searchParams.get("job");
    if (jobId) {
      const job = await resolveUpdateJob(jobId);
      if (!job) return Response.json({ error: "Update job not found. It may have expired after a service restart." }, { status: 404 });
      return Response.json(job, { headers: { "Cache-Control": "private, no-store" } });
    }
    const channel: UpdateChannel = searchParams.get("channel") === "commits" ? "commits" : "releases";
    const update = await checkForUpdate(config.root, fetch, channel);
    return Response.json(update, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const local = await loadLocalUpdateIdentity(config.root).catch(() => null);
    return Response.json({
      status: "check-failed",
      error: error instanceof Error ? error.message : "Could not check for updates.",
      currentRef: local?.currentRef || "unknown",
      currentManifest: local?.currentManifest,
      updateAvailable: false,
      latestTag: local?.currentManifest.tag || local?.currentManifest.version,
    }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const access = await requireHostAdmin(req, "Only host administrators can update Metis.");
  if ("response" in access) return access.response;

  let requestedTag: string | undefined;
  let requestedCommit: string | undefined;
  let channel: UpdateChannel = "releases";
  try {
    const body = await req.json().catch(() => ({})) as { tag?: unknown; commit?: unknown; channel?: unknown };
    if (typeof body.tag === "string") requestedTag = body.tag.trim();
    if (typeof body.commit === "string") requestedCommit = body.commit.trim();
    if (body.channel === "commits") channel = "commits";
  } catch {
    requestedTag = undefined;
  }

  try {
    if (requestedTag && requestedCommit) {
      return Response.json({ error: "Choose a release tag or a commit SHA, not both." }, { status: 400 });
    }
    if (requestedTag || requestedCommit) {
      if (config.docker && requestedCommit) {
        return Response.json({ error: "Pinning a commit is only supported for native installs." }, { status: 409 });
      }
      const release = requestedTag ? await fetchReleaseByTag(requestedTag, fetch, config.root) : null;
      const commit = requestedCommit ? await fetchCommitBySha(requestedCommit, fetch, config.root) : null;
      const pinnedChannel: UpdateChannel = requestedCommit ? "commits" : "releases";
      const tag = release ? (release.tag_name || requestedTag) : undefined;
      const commitSha = commit?.sha || requestedCommit;
      const job = await startInstallerUpdateJob({
        root: config.root,
        installDir: config.installDir,
        repository: await resolveGithubRepo(config.installDir),
        docker: config.docker,
        channel: pinnedChannel,
        tag,
        commit: commitSha,
        serviceName: config.serviceName,
        dataDir: config.dataDir,
      }, await rangeForUpdate(pinnedChannel, { tag, commit: commitSha }));
      const label = release?.tag_name || commit?.sha.slice(0, 12) || "the selected version";
      return Response.json({
        ok: true,
        status: "preparing",
        jobId: job.jobId,
        latestTag: release?.tag_name,
        latestCommit: commit?.sha,
        message: `Installing ${label}. Metis will show the updating screen until the installer finishes and restarts the services.`,
      }, { status: 202 });
    }

    const update = await checkForUpdate(config.root, fetch, channel);
    if (!update.updateAvailable) {
      return Response.json({
        status: update.status,
        message: update.status === "development"
          ? "This installation is a development build and is not eligible for an automatic stable update."
          : "No newer stable release is available.",
      }, { status: 409 });
    }
    if (requestedTag && requestedTag !== update.latestTag) {
      return Response.json({ error: "The requested release is not the currently verified latest stable release." }, { status: 409 });
    }
    if (channel === "commits" && !update.latestCommit) {
      throw new Error("GitHub did not return a master commit SHA.");
    }

    const job = await startInstallerUpdateJob({
      root: config.root,
        installDir: config.installDir,
        repository: await resolveGithubRepo(config.installDir),
      docker: config.docker,
      channel,
      tag: channel === "releases" ? update.latestTag : undefined,
      commit: update.latestCommit,
      serviceName: config.serviceName,
      dataDir: config.dataDir,
    }, await rangeForUpdate(channel, {
      tag: channel === "releases" ? update.latestTag : undefined,
      commit: update.latestCommit,
    }));
    return Response.json({
      ok: true,
      status: "preparing",
      jobId: job.jobId,
      latestTag: update.latestTag,
      latestCommit: update.latestCommit,
      message: "Installer update started. Metis will show the updating screen until the installer finishes and restarts the services.",
    }, { status: 202 });
  } catch (error) {
    if (error instanceof Error && /(?:already running|update request is starting)/.test(error.message)) {
      return Response.json({ status: "busy", error: error.message }, { status: 409 });
    }
    const detail = error && typeof error === "object" && "stderr" in error
      ? String((error as { stderr?: unknown }).stderr || "")
      : "";
    return Response.json({
      status: "failed",
      error: `${error instanceof Error ? error.message : "Metis update failed."}${detail ? `: ${detail.slice(-800)}` : ""}`,
    }, { status: 500 });
  }
}
