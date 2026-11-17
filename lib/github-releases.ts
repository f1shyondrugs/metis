import { execFile } from "node:child_process";
import { access, readFile, mkdtemp, rm, writeFile, cp, rename } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  loadReleaseManifest,
  normalizeReleaseTag,
  versionFromReleaseTag,
  type ReleaseManifest,
} from "@/lib/release-manifest";
import {
  commitChannelUpdateAvailable,
  sameGitSha,
  type UpdateCommitItem,
  type UpdateReleaseItem,
  type UpdateVersionList,
} from "@/lib/update-display";

export {
  commitChannelUpdateAvailable,
  formatUpdateInstalledLabel,
  sameGitSha,
  shortGitSha,
} from "@/lib/update-display";
export type { UpdateCommitItem, UpdateReleaseItem, UpdateVersionList } from "@/lib/update-display";

const execFileAsync = promisify(execFile);

async function resolvePnpm(root: string) {
  if (process.env.PNPM_BIN) return process.env.PNPM_BIN;
  const installedPnpm = path.join(root, ".runtime", "pnpm", "bin", "pnpm");
  try {
    await access(installedPnpm);
    return installedPnpm;
  } catch {
    return "pnpm";
  }
}
const DEFAULT_GITHUB_REPO = "f1shyondrugs/metis-ai";
const RELEASE_URL = `https://api.github.com/repos/${DEFAULT_GITHUB_REPO}/releases/latest`;
const USER_AGENT = "metis-ai-update-checker";
const cache: { etag?: string; release?: GithubRelease; checkedAt?: number } = {};
const CACHE_TTL_MS = 5 * 60_000;

export function githubRepoFromRemoteUrl(url?: string | null): string {
  const match = url?.trim().match(/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/i);
  return match?.[1] || DEFAULT_GITHUB_REPO;
}

export async function resolveGithubRepo(root: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], { cwd: root, timeout: 2_000 });
    return githubRepoFromRemoteUrl(stdout);
  } catch {
    return DEFAULT_GITHUB_REPO;
  }
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "User-Agent": USER_AGENT, Accept: "application/vnd.github+json" };
  const token = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function loadLocalUpdateIdentity(root: string) {
  const currentManifest = await loadReleaseManifest(root);
  const checkoutSha = await resolveCurrentGitHead(root);
  const currentRef = checkoutSha || currentManifest.commit || currentManifest.tag || currentManifest.version || "unknown";
  return { currentManifest, checkoutSha, currentRef };
}

async function resolveOriginMasterSha(root: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["ls-remote", "origin", "refs/heads/master"], { cwd: root, timeout: 8_000 });
    const sha = stdout.trim().split(/\s+/)[0] || "";
    return isGitCommitSha(sha) ? sha : null;
  } catch {
    return null;
  }
}

async function isGitAncestor(root: string, ancestor: string, descendant: string): Promise<boolean> {
  if (!ancestor.trim() || !descendant.trim()) return false;
  try {
    await execFileAsync("git", ["merge-base", "--is-ancestor", ancestor, descendant], { cwd: root, timeout: 2_000 });
    return true;
  } catch {
    return false;
  }
}

async function listLocalMasterCommits(root: string, currentCommit: string | null): Promise<UpdateCommitItem[]> {
  for (const ref of ["origin/master", "master", "HEAD"]) {
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["log", "-n", "30", "--format=%H%x1f%s%x1f%aI%x1f%an", ref],
        { cwd: root, timeout: 4_000 },
      );
      const commits = stdout.trim().split("\n").flatMap((line) => {
        const [sha, title, authoredAt, author] = line.split("\u001f");
        if (!sha || !isGitCommitSha(sha)) return [];
        return [{
          sha,
          shortSha: sha.slice(0, 12),
          title: title?.trim() || "Untitled commit",
          body: "",
          htmlUrl: `https://github.com/${DEFAULT_GITHUB_REPO}/commit/${sha}`,
          authoredAt: authoredAt?.trim() || null,
          author: author?.trim() || null,
          current: sameGitSha(sha, currentCommit),
        } satisfies UpdateCommitItem];
      });
      if (commits.length) return commits;
    } catch {
      /* try the next ref */
    }
  }
  return [];
}

export type GithubReleaseAsset = {
  name: string;
  browser_download_url: string;
  content_type?: string;
  size?: number;
};

export type GithubRelease = {
  tag_name: string;
  target_commitish?: string;
  name?: string;
  body?: string;
  html_url?: string;
  published_at?: string;
  prerelease?: boolean;
  draft?: boolean;
  assets?: GithubReleaseAsset[];
};

export type UpdateChannel = "releases" | "commits";
export type UpdateStatus = "development" | "up-to-date" | "available" | "commit-available";

export type GithubCommit = {
  sha: string;
  html_url?: string;
  commit?: {
    message?: string;
    author?: { name?: string; date?: string };
    committer?: { name?: string; date?: string };
  };
  author?: { login?: string };
};

export type UpdateCheck = {
  channel: UpdateChannel;
  status: UpdateStatus;
  latestTag: string;
  latestCommit?: string;
  commitUrl?: string;
  commitMessage?: string;
  currentRef: string;
  currentManifest: ReleaseManifest;
  updateAvailable: boolean;
  release?: GithubRelease;
};

export async function fetchLatestRelease(fetcher: typeof fetch = fetch): Promise<GithubRelease> {
  const now = Date.now();
  if (cache.release && cache.checkedAt && now - cache.checkedAt < CACHE_TTL_MS) return cache.release;
  const headers: Record<string, string> = githubHeaders();
  if (cache.etag) headers["If-None-Match"] = cache.etag;
  const response = await fetcher(RELEASE_URL, { headers, cache: "no-store" });
  if (response.status === 304 && cache.release) {
    cache.checkedAt = now;
    return cache.release;
  }
  if (!response.ok) throw new Error(`GitHub release lookup failed (${response.status}).`);
  const release = (await response.json()) as GithubRelease;
  if (!normalizeReleaseTag(release.tag_name)) throw new Error("GitHub returned a release without a valid SemVer tag.");
  if (release.draft || release.prerelease) throw new Error("GitHub returned a non-stable release for the stable channel.");
  cache.etag = response.headers.get("etag") || cache.etag;
  cache.release = release;
  cache.checkedAt = now;
  return release;
}

export async function fetchLatestCommit(fetcher: typeof fetch = fetch, root?: string): Promise<GithubCommit> {
  const repo = root ? await resolveGithubRepo(root) : DEFAULT_GITHUB_REPO;
  const response = await fetcher(`https://api.github.com/repos/${repo}/commits/master`, {
    headers: githubHeaders(),
    cache: "no-store",
  });
  if (response.ok) {
    const commit = (await response.json()) as GithubCommit;
    if (commit.sha) return commit;
  }
  if (root) {
    const sha = await resolveOriginMasterSha(root);
    if (sha) return { sha };
  }
  if (!response.ok) throw new Error(`GitHub commit lookup failed (${response.status}).`);
  throw new Error("GitHub returned a commit without a SHA.");
}

export function isGitCommitSha(value: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(value.trim());
}

function splitCommitMessage(message?: string) {
  const text = message?.trim() || "";
  const [title, ...rest] = text.split(/\n/);
  return { title: title || "Untitled commit", body: rest.join("\n").trim() };
}

export async function fetchReleaseByTag(tag: string, fetcher: typeof fetch = fetch, root?: string): Promise<GithubRelease> {
  const normalized = normalizeReleaseTag(tag);
  if (!normalized) throw new Error("Release tag must look like v1.0.0.");
  const repo = root ? await resolveGithubRepo(root) : DEFAULT_GITHUB_REPO;
  const response = await fetcher(`https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(normalized)}`, {
    headers: githubHeaders(),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`GitHub release ${normalized} was not found (${response.status}).`);
  const release = (await response.json()) as GithubRelease;
  if (release.draft) throw new Error(`GitHub release ${normalized} is a draft.`);
  return release;
}

export async function fetchCommitBySha(sha: string, fetcher: typeof fetch = fetch, root?: string): Promise<GithubCommit> {
  const value = sha.trim();
  if (!isGitCommitSha(value)) throw new Error("Commit must be a git SHA.");
  const repo = root ? await resolveGithubRepo(root) : DEFAULT_GITHUB_REPO;
  const response = await fetcher(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(value)}`, {
    headers: githubHeaders(),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`GitHub commit ${value.slice(0, 12)} was not found (${response.status}).`);
  const commit = (await response.json()) as GithubCommit;
  if (!commit.sha) throw new Error("GitHub returned a commit without a SHA.");
  return commit;
}

export async function listUpdateVersions(root: string, fetcher: typeof fetch = fetch): Promise<UpdateVersionList> {
  const { currentManifest: manifest, checkoutSha: head } = await loadLocalUpdateIdentity(root);
  const currentCommit = head || manifest.commit || null;
  const currentTag = manifest.tag || null;
  const repo = await resolveGithubRepo(root);
  const [releasesResponse, commitsResponse] = await Promise.all([
    fetcher(`https://api.github.com/repos/${repo}/releases?per_page=20`, { headers: githubHeaders(), cache: "no-store" }),
    fetcher(`https://api.github.com/repos/${repo}/commits?sha=master&per_page=30`, { headers: githubHeaders(), cache: "no-store" }),
  ]);
  if (!releasesResponse.ok && !commitsResponse.ok) {
    const local = await listLocalMasterCommits(root, currentCommit);
    if (local.length) {
      return {
        currentRef: currentTag || currentCommit || manifest.version,
        currentCommit,
        currentTag,
        releases: [],
        commits: local,
      };
    }
    throw new Error(`GitHub version list failed (${releasesResponse.status}/${commitsResponse.status}).`);
  }
  if (!releasesResponse.ok) throw new Error(`GitHub release list failed (${releasesResponse.status}).`);
  if (!commitsResponse.ok) throw new Error(`GitHub commit list failed (${commitsResponse.status}).`);
  const rawReleases = (await releasesResponse.json()) as GithubRelease[];
  const rawCommits = (await commitsResponse.json()) as GithubCommit[];
  const releases = (Array.isArray(rawReleases) ? rawReleases : [])
    .filter((release) => !release.draft && normalizeReleaseTag(release.tag_name))
    .map((release) => {
      const tag = normalizeReleaseTag(release.tag_name) || release.tag_name;
      return {
        tag,
        name: release.name?.trim() || tag,
        body: release.body?.trim() || "",
        htmlUrl: release.html_url || `https://github.com/f1shyondrugs/metis-ai/releases/tag/${encodeURIComponent(tag)}`,
        publishedAt: release.published_at || null,
        prerelease: Boolean(release.prerelease),
        current: Boolean(currentTag && tag === currentTag),
      } satisfies UpdateReleaseItem;
    });
  const commits = (Array.isArray(rawCommits) ? rawCommits : [])
    .filter((commit) => commit.sha)
    .map((commit) => {
      const split = splitCommitMessage(commit.commit?.message);
      return {
        sha: commit.sha,
        shortSha: commit.sha.slice(0, 12),
        title: split.title,
        body: split.body,
        htmlUrl: commit.html_url || `https://github.com/f1shyondrugs/metis-ai/commit/${commit.sha}`,
        authoredAt: commit.commit?.author?.date || commit.commit?.committer?.date || null,
        author: commit.commit?.author?.name || commit.author?.login || null,
        current: sameGitSha(commit.sha, currentCommit),
      } satisfies UpdateCommitItem;
    });
  return {
    currentRef: currentTag || currentCommit || manifest.version,
    currentCommit,
    currentTag,
    releases,
    commits,
  };
}

export async function resolveCurrentRef(root: string): Promise<string> {
  const configured = process.env.METIS_RELEASE_TAG?.trim();
  if (configured) return configured;
  const head = await resolveCurrentGitHead(root);
  if (head) return head;
  try {
    const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as { version?: unknown };
    return typeof packageJson.version === "string" ? packageJson.version.trim() : "unknown";
  } catch {
    return "unknown";
  }
}

export async function resolveCurrentGitHead(root: string): Promise<string | null> {
  const configured = process.env.METIS_RELEASE_COMMIT?.trim() || process.env.GITHUB_SHA?.trim();
  if (configured) return configured;
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root, timeout: 2_000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function parseVersion(value: string) {
  const tag = normalizeReleaseTag(value);
  if (!tag) return null;
  const version = versionFromReleaseTag(tag);
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split(".") || [],
  };
}

export function compareReleaseVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return 0;
  for (const key of ["major", "minor", "patch"] as const) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  }
  if (!a.prerelease.length && !b.prerelease.length) return 0;
  if (!a.prerelease.length) return 1;
  if (!b.prerelease.length) return -1;
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const left = a.prerelease[index];
    const right = b.prerelease[index];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    if (left === right) continue;
    const leftNumeric = /^\\d+$/.test(left);
    const rightNumeric = /^\\d+$/.test(right);
    if (leftNumeric && rightNumeric) return Number(left) > Number(right) ? 1 : -1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return left > right ? 1 : -1;
  }
  return 0;
}

export function isReleaseNewer(release: GithubRelease, currentRef: string) {
  const current = currentRef.trim();
  const releaseTag = normalizeReleaseTag(release.tag_name);
  if (!releaseTag || !current || current === "unknown") return false;
  const currentTag = normalizeReleaseTag(current);
  if (currentTag) return compareReleaseVersions(releaseTag, currentTag) > 0;
  // A commit checkout is a development build. It is not safe to infer that a
  // stable release is newer without a versioned release marker.
  return false;
}

export async function checkForUpdate(
  root: string,
  fetcher: typeof fetch = fetch,
  channel: UpdateChannel = "releases",
): Promise<UpdateCheck> {
  const { currentManifest, checkoutSha, currentRef } = await loadLocalUpdateIdentity(root);
  if (channel === "commits") {
    const commit = await fetchLatestCommit(fetcher, root);
    let updateAvailable = commitChannelUpdateAvailable(commit.sha, currentManifest.commit, checkoutSha);
    const currentCheckout = checkoutSha || currentManifest.commit || currentRef;
    if (updateAvailable && currentCheckout && await isGitAncestor(root, commit.sha, currentCheckout)) {
      updateAvailable = false;
    }
    return {
      channel,
      status: updateAvailable ? "commit-available" : "up-to-date",
      latestTag: currentManifest.tag || currentManifest.version,
      latestCommit: commit.sha,
      commitUrl: commit.html_url,
      commitMessage: commit.commit?.message,
      currentRef: currentCheckout,
      currentManifest,
      updateAvailable,
    };
  }

  const release = await fetchLatestRelease(fetcher);
  const latestTag = normalizeReleaseTag(release.tag_name);
  if (!latestTag) throw new Error("Latest GitHub release has no valid SemVer tag.");
  const updateAvailable = compareReleaseVersions(latestTag, currentManifest.version) > 0;
  return {
    channel,
    status: updateAvailable ? "available" : "up-to-date",
    latestTag,
    currentRef,
    currentManifest,
    updateAvailable,
    release,
  };
}

export function releaseBundleAsset(release: GithubRelease) {
  const tag = normalizeReleaseTag(release.tag_name);
  if (!tag) return null;
  const expectedName = `metis-ai-${tag}.tar.gz`;
  return release.assets?.find((asset) => asset.name === expectedName) || null;
}

export async function prepareNativeReleaseUpdate(
  root: string,
  release: GithubRelease,
  activeSlot: ".next-a" | ".next-b",
  fetcher: typeof fetch = fetch,
  logger?: (message: string) => void,
) {
  const asset = releaseBundleAsset(release);
  if (!asset) throw new Error("The latest release does not contain the required native bundle asset.");
  const tag = normalizeReleaseTag(release.tag_name);
  if (!tag) throw new Error("The latest release does not have a valid SemVer tag.");
  const inactiveSlot = activeSlot === ".next-a" ? ".next-b" : ".next-a";
  const stage = await mkdtemp(path.join(os.tmpdir(), "metis-release-"));
  const archive = path.join(stage, asset.name);
  let operation = "starting native release update";
  const log = (message: string) => logger?.(message);
  log(operation);
  try {
    operation = "downloading the verified release bundle";
    log(operation);
    const response = await fetcher(asset.browser_download_url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/octet-stream" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Release bundle download failed (${response.status}).`);
    await writeFile(archive, Buffer.from(await response.arrayBuffer()));
    const source = path.join(stage, "source");
    operation = "creating the temporary update workspace";
    log(operation);
    await execFileAsync("mkdir", ["-p", source]);
    operation = "extracting the release bundle";
    log(operation);
    await execFileAsync("tar", ["-xzf", archive, "-C", source, "--strip-components=1"], { timeout: 60_000 });
    operation = "installing locked release dependencies";
    log(operation);
    await execFileAsync(await resolvePnpm(root), ["install", "--frozen-lockfile"], {
      cwd: source,
      timeout: 15 * 60_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    operation = `building the inactive production slot ${inactiveSlot}`;
    log(operation);
    await execFileAsync("bash", ["scripts/build-production-slot.sh", inactiveSlot], {
      cwd: source,
      env: {
        ...process.env,
        AI_CHAT_ROOT: source,
        PNPM_BIN: await resolvePnpm(root),
        METIS_RELEASE_TAG: tag,
        METIS_RELEASE_VERSION: versionFromReleaseTag(tag),
        METIS_RELEASE_COMMIT: release.target_commitish || "",
        NODE_ENV: "production",
      },
      timeout: 30 * 60_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    operation = `installing the prepared ${inactiveSlot} slot`;
    log(operation);
    const preparedSlot = path.join(root, inactiveSlot);
    const incomingSlot = `${preparedSlot}.incoming`;
    await rm(incomingSlot, { recursive: true, force: true });
    await cp(path.join(source, inactiveSlot), incomingSlot, { recursive: true });
    await rm(preparedSlot, { recursive: true, force: true });
    await rename(incomingSlot, preparedSlot);
    return { tag, activeSlot, preparedSlot: inactiveSlot, asset: asset.name };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stderr = error && typeof error === "object" && "stderr" in error
      ? String((error as { stderr?: unknown }).stderr || "").trim()
      : "";
    log(`${operation} failed: ${message}`);
    throw new Error(`${operation} failed: ${message}${stderr ? ` — ${stderr.slice(-1200)}` : ""}`);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

export async function prepareNativeCommitUpdate(
  root: string,
  commit: GithubCommit,
  activeSlot: ".next-a" | ".next-b",
  fetcher: typeof fetch = fetch,
  logger?: (message: string) => void,
) {
  const sha = commit.sha.trim();
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) throw new Error("The master commit SHA is invalid.");
  const inactiveSlot = activeSlot === ".next-a" ? ".next-b" : ".next-a";
  const stage = await mkdtemp(path.join(os.tmpdir(), "metis-commit-"));
  const archive = path.join(stage, `metis-ai-master-${sha}.tar.gz`);
  let operation = "starting native master commit update";
  const log = (message: string) => logger?.(message);
  log(operation);
  try {
    operation = `downloading master commit ${sha.slice(0, 12)}`;
    log(operation);
    const response = await fetcher(`https://github.com/f1shyondrugs/metis-ai/archive/${sha}.tar.gz`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/octet-stream" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Master commit download failed (${response.status}).`);
    await writeFile(archive, Buffer.from(await response.arrayBuffer()));
    const source = path.join(stage, "source");
    operation = "creating the temporary update workspace";
    log(operation);
    await execFileAsync("mkdir", ["-p", source]);
    operation = "extracting the master commit";
    log(operation);
    await execFileAsync("tar", ["-xzf", archive, "-C", source, "--strip-components=1"], { timeout: 60_000 });
    operation = "installing locked commit dependencies";
    log(operation);
    await execFileAsync(await resolvePnpm(root), ["install", "--frozen-lockfile"], { cwd: source, timeout: 15 * 60_000, maxBuffer: 2 * 1024 * 1024 });
    operation = `building the inactive production slot ${inactiveSlot}`;
    log(operation);
    await execFileAsync("bash", ["scripts/build-production-slot.sh", inactiveSlot], {
      cwd: source,
      env: { ...process.env, AI_CHAT_ROOT: source, PNPM_BIN: await resolvePnpm(root), METIS_RELEASE_TAG: "", METIS_RELEASE_COMMIT: sha, NODE_ENV: "production" },
      timeout: 30 * 60_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    operation = `installing the prepared ${inactiveSlot} slot`;
    log(operation);
    const preparedSlot = path.join(root, inactiveSlot);
    const incomingSlot = `${preparedSlot}.incoming`;
    await rm(incomingSlot, { recursive: true, force: true });
    await cp(path.join(source, inactiveSlot), incomingSlot, { recursive: true });
    await rm(preparedSlot, { recursive: true, force: true });
    await rename(incomingSlot, preparedSlot);
    return { tag: "master", commit: sha, activeSlot, preparedSlot: inactiveSlot, asset: archive };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stderr = error && typeof error === "object" && "stderr" in error ? String((error as { stderr?: unknown }).stderr || "").trim() : "";
    log(`${operation} failed: ${message}`);
    throw new Error(`${operation} failed: ${message}${stderr ? ` — ${stderr.slice(-1200)}` : ""}`);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
