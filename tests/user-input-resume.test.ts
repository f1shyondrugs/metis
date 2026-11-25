import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  isJobWaitingForUser,
  shouldQueueUserInputResume,
} from "../lib/user-input-resume";

const root = path.resolve(import.meta.dirname, "..");

test("late answers resume failed or stale paused jobs without duplicating live runs", () => {
  const now = Date.parse("2026-09-22T15:00:00.000Z");
  const fresh = "2026-09-22T14:59:59.000Z";
  const stale = "2026-09-22T14:59:50.000Z";

  assert.equal(shouldQueueUserInputResume("error", fresh, now), true);
  assert.equal(shouldQueueUserInputResume("interrupted", fresh, now), true);
  assert.equal(shouldQueueUserInputResume("waiting_input", fresh, now), false);
  assert.equal(shouldQueueUserInputResume("running", fresh, now), false);
  assert.equal(shouldQueueUserInputResume("waiting_input", stale, now), true);
  assert.equal(shouldQueueUserInputResume("waiting_for_user", undefined, now), true);
  assert.equal(shouldQueueUserInputResume(undefined, stale, now), false);
  assert.equal(isJobWaitingForUser("waiting_input"), true);
  assert.equal(isJobWaitingForUser("waiting_for_user"), true);
  assert.equal(isJobWaitingForUser("running"), false);
});

test("interactive MCP waits propagate cancellation and preserve durable pause state", () => {
  const gateway = readFileSync(
    path.join(root, "lib", "mcp-core", "gateway-core.mjs"),
    "utf8",
  );
  const questionRoute = readFileSync(
    path.join(root, "app", "api", "internal", "mcp-question", "route.ts"),
    "utf8",
  );
  const providerRunner = readFileSync(
    path.join(root, "lib", "providers", "runner.ts"),
    "utf8",
  );
  const cursorRunner = readFileSync(
    path.join(root, "lib", "worker-runner.ts"),
    "utf8",
  );

  assert.match(gateway, /signal: extra\?\.signal/);
  assert.match(
    gateway,
    /signal: options\.signal/,
  );
  assert.match(gateway, /await ensureRuntimeApproval\(name, args, context, options\.signal, policy\)/);
  assert.match(questionRoute, /req\.signal\.addEventListener\("abort"/);
  assert.match(questionRoute, /pending\.stop\(\)/);
  assert.match(providerRunner, /isJobWaitingForUser\(durableStatus\)/);
  assert.match(cursorRunner, /isJobWaitingForUser\(pausedStatus\)/);
});
