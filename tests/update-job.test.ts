import assert from "node:assert/strict";
import test from "node:test";
import { installerJobFinishedMessage, pollInstallerJob, reloadCompletedInstallerJob, requestInstallerUpdate, UPDATE_JOB_STORAGE_KEY, type InstallerUpdateRequest } from "../lib/update-job-client";
import { installerUpdateJobMarker } from "../lib/installer-update";
import { settleUpdateJobFromInstaller } from "../lib/update-job";

test("server update requests preserve the chosen channel or pinned revision and require a job", async () => {
  const requests: InstallerUpdateRequest[] = [
    { channel: "releases" },
    { channel: "commits" },
    { channel: "releases", tag: "v1.2.3" },
    { channel: "commits", commit: "1234abcd" },
  ];
  for (const input of requests) {
    let posts = 0;
    const job = await requestInstallerUpdate(input, async (url, request) => {
      ++posts;
      assert.equal(url, "/api/admin/system/update");
      assert.equal(request?.method, "POST");
      assert.equal(new Headers(request.headers).get("content-type"), "application/json");
      assert.deepEqual(JSON.parse(String(request.body)), input);
      return Response.json({ status: "preparing", jobId: "installer-job", message: "Server update started." }, { status: 202 });
    });
    assert.equal(posts, 1);
    assert.deepEqual(job, { jobId: "installer-job", message: "Server update started." });
  }
});

test("a refused or unverified installer job never reports success", async () => {
  const input = { channel: "releases" } as const;
  for (const [response, expected] of [
    [Response.json({ message: "No newer stable release is available." }, { status: 409 }), /No newer stable release/],
    [Response.json({ status: "busy", error: "An installer update is already running." }, { status: 409 }), /already running/],
    [Response.json({ error: "Only host administrators can update Metis." }, { status: 403 }), /Only host administrators/],
    [new Response("<html>proxy</html>", { status: 502 }), /HTTP 502/],
    [Response.json({ status: "preparing" }, { status: 202 }), /Could not verify the update job/],
    [new Response("<html>unexpected success page</html>", { status: 200 }), /Could not verify the update job/],
  ] as const) {
    let posts = 0;
    await assert.rejects(requestInstallerUpdate(input, async () => { ++posts; return response; }), expected);
    assert.equal(posts, 1);
  }
  let posts = 0;
  await assert.rejects(
    requestInstallerUpdate(input, async () => { ++posts; throw new TypeError("Network failure"); }),
    /Check update status before trying again/,
  );
  assert.equal(posts, 1);
});

const preparing = {
  jobId: "job-1",
  status: "preparing" as const,
  startedAt: "2026-09-13T20:00:00.000Z",
  startedByPid: 100,
  logs: ["started"],
};

const marker = installerUpdateJobMarker(preparing.jobId);

test("settlement keeps preparing while the installer unit is running", () => {
  const next = settleUpdateJobFromInstaller(preparing, {
    installerRunning: true,
    logText: `${marker}\nBuilding...`,
    currentPid: 100,
  });
  assert.equal(next.status, "preparing");
});

test("settlement ignores a stale success log from another update", () => {
  const next = settleUpdateJobFromInstaller(preparing, {
    installerRunning: false,
    logText: "Metis AI installed successfully.",
    currentPid: 200,
  });
  assert.equal(next.status, "preparing");
  assert.equal(next.finishedAt, undefined);
});

test("settlement marks ready after the installer restarts Metis", () => {
  const next = settleUpdateJobFromInstaller(preparing, {
    installerRunning: false,
    logText: `${marker}\nMetis AI installed successfully.\nOpen: http://127.0.0.1:3100`,
    currentPid: 200,
    now: "2026-09-13T21:00:00.000Z",
  });
  assert.equal(next.status, "ready");
  assert.equal(next.finishedAt, "2026-09-13T21:00:00.000Z");
});

test("settlement stays preparing until Metis runs in a new process", () => {
  const next = settleUpdateJobFromInstaller(preparing, {
    installerRunning: false,
    logText: `${marker}\nMetis AI installed successfully.`,
    currentPid: 100,
  });
  assert.equal(next.status, "preparing");
  assert.equal(next.finishedAt, undefined);
});

test("settlement marks failed when the installer log has an error", () => {
  const next = settleUpdateJobFromInstaller(preparing, {
    installerRunning: false,
    logText: `${marker}\nError: git pull failed`,
    currentPid: 100,
  });
  assert.equal(next.status, "failed");
});

test("a missing job never reports a successful update", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/admin/system/update?job=")) return new Response(JSON.stringify({ error: "missing" }), { status: 404 });
    if (url.includes("/api/system/maintenance")) return new Response(JSON.stringify({ active: false }), { status: 200 });
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  try {
    const job = await pollInstallerJob("lost-after-restart");
    assert.equal(job.status, "failed");
    assert.match(job.error || "", /could not be verified/i);
    assert.match(installerJobFinishedMessage(), /running again/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("successful update reloads once and consumes the job before navigation", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map([[UPDATE_JOB_STORAGE_KEY, "completed-job"]]);
  let reloads = 0;
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
    },
    location: { reload: () => {
      assert.equal(values.has(UPDATE_JOB_STORAGE_KEY), false);
      reloads++;
    } },
  } });
  try {
    assert.equal(reloadCompletedInstallerJob("completed-job", { status: "preparing" }), false);
    assert.equal(reloadCompletedInstallerJob("completed-job", { status: "restarting" }), false);
    assert.equal(reloadCompletedInstallerJob("completed-job", { status: "failed" }), false);
    assert.equal(values.get(UPDATE_JOB_STORAGE_KEY), "completed-job");
    assert.equal(reloads, 0);
    assert.equal(reloadCompletedInstallerJob("completed-job", { status: "ready" }), true);
    assert.equal(reloadCompletedInstallerJob("completed-job", { status: "ready" }), false);
    assert.equal(reloads, 1);
    // A late result from an old job must not consume a newer pending update.
    values.set(UPDATE_JOB_STORAGE_KEY, "new-job");
    assert.equal(reloadCompletedInstallerJob("completed-job", { status: "ready" }), false);
    assert.equal(values.get(UPDATE_JOB_STORAGE_KEY), "new-job");
    assert.equal(reloads, 1);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("update completion is safe outside the browser", () => {
  assert.equal(reloadCompletedInstallerJob("job", { status: "ready" }), false);
});
