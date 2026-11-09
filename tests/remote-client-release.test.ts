import assert from "node:assert/strict";
import test from "node:test";
import {
  latestWindowsInstallerUrl,
  legacyWindowsUpdate,
  remoteDesktopDownloads,
  REMOTE_CLIENT_RELEASE_API,
  WINDOWS_INSTALLER,
  WINDOWS_INSTALLER_URL,
  WINDOWS_RELEASE_BASE,
  WINDOWS_UPDATE_METADATA,
  windowsReleaseUrl,
} from "../lib/remote-client-release";

const LATEST_V142 = {
  tag_name: "v1.4.2",
  assets: [
    { name: "Metis-AI-Remote-Client-arm64.dmg" },
    { name: "Metis-AI-Remote-Client-x86_64.AppImage" },
    { name: WINDOWS_INSTALLER },
    { name: WINDOWS_UPDATE_METADATA },
  ],
};

function githubFetcher(init?: { api?: unknown; files?: Record<string, Response> }) {
  const requested: string[] = [];
  const fetcher = (async (input: string | URL | Request, requestInit?: RequestInit) => {
    const url = String(input);
    requested.push(url);
    if (url.includes("api.github.com")) {
      if (init?.api instanceof Response) return init.api;
      return Response.json(init?.api ?? LATEST_V142);
    }
    if (init?.files?.[url]) return init.files[url];
    if (url.endsWith(WINDOWS_UPDATE_METADATA)) {
      return new Response("version: 1.4.2\n", { headers: { "content-type": "application/octet-stream" } });
    }
    return new Response("missing", { status: 404 });
  }) as typeof fetch;
  return { fetcher, requested, init: [] as RequestInit[] };
}

test("Windows client files come from public GitHub releases", () => {
  assert.equal(WINDOWS_INSTALLER_URL, "https://github.com/f1shyondrugs/Metis-Apps/releases/latest/download/Metis-AI-Remote-Client-Setup.exe");
  assert.equal(windowsReleaseUrl(WINDOWS_UPDATE_METADATA), WINDOWS_RELEASE_BASE + "latest.yml");
  assert.equal(windowsReleaseUrl("../secret"), null);
});

test("Devices downloads use the GitHub latest release tag for every platform", async () => {
  const { fetcher, requested } = githubFetcher();
  assert.equal(
    await latestWindowsInstallerUrl(fetcher),
    "https://github.com/f1shyondrugs/Metis-Apps/releases/download/v1.4.2/Metis-AI-Remote-Client-Setup.exe",
  );
  assert.deepEqual(await remoteDesktopDownloads("windows", fetcher), [
    { label: "Windows installer", url: "https://github.com/f1shyondrugs/Metis-Apps/releases/download/v1.4.2/Metis-AI-Remote-Client-Setup.exe" },
  ]);
  assert.deepEqual(await remoteDesktopDownloads("macos", fetcher), [
    { label: "macOS · Apple Silicon", url: "https://github.com/f1shyondrugs/Metis-Apps/releases/download/v1.4.2/Metis-AI-Remote-Client-arm64.dmg" },
  ]);
  assert.deepEqual(await remoteDesktopDownloads("linux", fetcher), [
    { label: "Linux · Intel / AMD", url: "https://github.com/f1shyondrugs/Metis-Apps/releases/download/v1.4.2/Metis-AI-Remote-Client-x86_64.AppImage" },
  ]);
  assert.ok(requested.every((url) => url === REMOTE_CLIENT_RELEASE_API || url.includes("/releases/download/v1.4.2/") || url.includes("api.github.com")));
});

test("legacy paired-client update proxies the tagged latest asset without forwarding credentials", async () => {
  const requested: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    requested.push({ url: String(input), init });
    if (String(input).includes("api.github.com")) return Response.json(LATEST_V142);
    return new Response("version: 1.4.2\n", { headers: { "content-type": "application/octet-stream" } });
  }) as typeof fetch;
  const response = await legacyWindowsUpdate(WINDOWS_UPDATE_METADATA, fetcher);
  assert.equal(response?.status, 200);
  assert.equal(await response?.text(), "version: 1.4.2\n");
  assert.deepEqual(requested.map((request) => request.url), [
    REMOTE_CLIENT_RELEASE_API,
    "https://github.com/f1shyondrugs/Metis-Apps/releases/download/v1.4.2/latest.yml",
  ]);
  assert.equal(requested[1]?.init?.headers, undefined);
  assert.equal(response?.headers.get("content-type"), "text/yaml; charset=utf-8");
});

test("legacy proxy rejects unknown files and error documents", async () => {
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    return new Response('{"error":"missing"}', { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  assert.equal(await legacyWindowsUpdate("../secret", fetcher), null);
  assert.equal(calls, 0);
  assert.equal(await legacyWindowsUpdate(WINDOWS_INSTALLER, fetcher), null);
  assert.equal(calls, 2);
});

test("unix downloads fall back to HEAD checks when the GitHub API is unavailable", async () => {
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("api.github.com")) return new Response("rate limited", { status: 403 });
    if (url.endsWith("Metis-AI-Remote-Client-arm64.dmg")) return new Response(null, { status: 200 });
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  assert.deepEqual(await remoteDesktopDownloads("macos", fetcher), [
    { label: "macOS · Apple Silicon", url: WINDOWS_RELEASE_BASE + "Metis-AI-Remote-Client-arm64.dmg" },
  ]);
  assert.deepEqual(await remoteDesktopDownloads("linux", fetcher), []);
  assert.equal(await latestWindowsInstallerUrl(fetcher), WINDOWS_INSTALLER_URL);
});
