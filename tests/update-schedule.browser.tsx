import React from "react";
import { createRoot } from "react-dom/client";
import { UpdateSettingsPanel } from "../components/update-channel-nav";
import { UPDATE_JOB_STORAGE_KEY } from "../lib/update-job-client";

localStorage.removeItem(UPDATE_JOB_STORAGE_KEY);

type Schedule = { enabled: boolean; time: string; timezone: string };
type SchedulePatch = Partial<Schedule>;

const scheduleUrl = "/api/admin/system/update-schedule";
const initialNextCheck = "2026-11-19T03:00:00.000Z";
const nextCheck = "2026-11-19T05:35:00.000Z";
const changedNextCheck = "2026-11-19T12:40:00.000Z";
const nextChecks: Readonly<Record<string, string>> = { "06:35": nextCheck, "07:40": changedNextCheck };
let stored: Schedule = { enabled: true, time: "03:00", timezone: "UTC" };
let pendingGet: (() => void) | undefined;
let holdNextGet = false;
let failNextPut = false;
let pollSchedule: (() => void) | undefined;
const writes: SchedulePatch[] = [];
const installs: unknown[] = [];
let acceptInstall: (() => void) | undefined;

const browserTimers: Window = window;
const setInterval = browserTimers.setInterval.bind(browserTimers);
browserTimers.setInterval = (handler, timeout, ...args) => {
  if (timeout === 30_000 && typeof handler === "function") {
    pollSchedule = () => handler(...args);
    return setInterval(() => undefined, 30_000);
  }
  return setInterval(handler, timeout, ...args);
};

function snapshot() {
  return {
    schedule: { ...stored },
    nextRunAt: stored.enabled ? nextChecks[stored.time] ?? initialNextCheck : null,
  };
}

window.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  const method = init?.method || (input instanceof Request ? input.method : "GET");
  if (url.pathname === scheduleUrl && method === "GET") {
    const response = Response.json(snapshot());
    if (holdNextGet) {
      holdNextGet = false;
      return new Promise<Response>((resolve) => { pendingGet = () => resolve(response); });
    }
    return response;
  }
  if (url.pathname === scheduleUrl && method === "PUT") {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as SchedulePatch : undefined;
    if (!body) return Response.json({ error: "Invalid fixture request" }, { status: 400 });
    writes.push(body);
    if (failNextPut) {
      failNextPut = false;
      return Response.json({ error: "Synthetic schedule save failure" }, { status: 503 });
    }
    stored = { ...stored, ...body };
    return Response.json(snapshot());
  }
  if (url.pathname === "/api/admin/system/update") {
    if (method === "POST") {
      installs.push(JSON.parse(String(init?.body)));
      return new Promise<Response>((resolve) => {
        acceptInstall = () => resolve(Response.json({ status: "preparing", jobId: "fixture-install" }, { status: 202 }));
      });
    }
    if (method === "GET") {
      return url.searchParams.has("job")
        ? Response.json({ status: "preparing" })
        : Response.json({ status: "update-available", updateAvailable: true, latestTag: "v1.2.3", currentRef: "fixture" });
    }
  }
  return Response.json({ error: "Unexpected request in isolated update schedule fixture" }, { status: 404 });
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function button(label: string) {
  return [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === label);
}

function field(label: string) {
  const input = [...document.querySelectorAll("label")]
    .find((item) => item.textContent?.trim() === label)
    ?.querySelector("input");
  assert(input, `Missing ${label} input`);
  return input;
}

function setField(label: string, value: string) {
  const input = field(label);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function writeMatches(index: number, expected: SchedulePatch) {
  const write = writes[index];
  assert(write, `PUT ${index + 1} missing`);
  assert(
    Object.keys(write).length === Object.keys(expected).length &&
    Object.entries(expected).every(([key, value]) => write[key as keyof Schedule] === value),
    `PUT ${index + 1}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(write)}`,
  );
}

const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
async function waitFor(check: () => unknown, description: string) {
  const deadline = performance.now() + 5_000;
  do {
    if (check()) return;
    await frame();
  } while (performance.now() < deadline);
  throw new Error(`Timed out: ${description}`);
}

async function press(label: string) {
  await waitFor(() => {
    const candidate = button(label);
    return candidate && !candidate.disabled;
  }, `${label} enabled`);
  button(label)!.click();
}

async function waitForConfirm() {
  await waitFor(() => button("Install and restart"), "confirmation action mounted");
  return button("Install and restart")!;
}

function hasNextCheck(time: string, timezone: string) {
  const expected = new Date(time).toLocaleString("en", { dateStyle: "medium", timeStyle: "short", hourCycle: "h23", timeZone: timezone });
  return document.body.textContent?.includes(`Next check: ${expected} (${timezone})`);
}

function Fixture() {
  return <main className="mx-auto max-w-2xl px-4 py-8">
    <p className="mb-5 text-xs text-muted-foreground">Test fixture · simulated server updates</p>
    <UpdateSettingsPanel isHostAdmin onUpdateAvailableChange={ignoreUpdateAvailable} />
    <output id="schedule-check-output" className="mt-6 block whitespace-pre-wrap text-sm" aria-live="polite">
      Schedule fixture ready.
    </output>
  </main>;
}

const ignoreUpdateAvailable = () => undefined;
createRoot(document.getElementById("root")!).render(<Fixture />);

async function checkSchedule() {
  await waitFor(() => document.getElementById("schedule-check-output"), "fixture mounted");
  const output = document.getElementById("schedule-check-output")!;
  const checks: string[] = [];
  const pass = (description: string) => {
    checks.push(description);
    output.textContent = checks.join("\n");
  };
  try {
    await waitFor(() => button("Disable automatic updates"), "active schedule loaded");

    setField("Time", "06:35");
    setField("Timezone", "Europe/Berlin");
    await press("Save schedule");
    await waitFor(() => writes.length === 1 && stored.time === "06:35", "active schedule saved");
    writeMatches(0, { time: "06:35", timezone: "Europe/Berlin" });
    assert(stored.enabled, "Save schedule deactivated automatic updates");
    await waitFor(() => hasNextCheck(nextCheck, "Europe/Berlin") && button("Disable automatic updates")?.disabled === false, "active state shown");
    pass("PASS: Saving a time and timezone keeps the active schedule enabled.");

    setField("Time", "07:40");
    setField("Timezone", "America/New_York");
    await press("Disable automatic updates");
    await waitFor(() => button("Enable automatic updates"), "disabled state shown");
    writeMatches(1, { enabled: false });
    assert(stored.time === "06:35" && stored.timezone === "Europe/Berlin", "Toggling saved unsaved schedule fields");
    assert(field("Time").value === "07:40" && field("Timezone").value === "America/New_York", "Toggling discarded the schedule draft");
    assert(!document.body.textContent?.includes("Next check:"), "Disabled schedule still shows a next check");
    await press("Enable automatic updates");
    await waitFor(() => button("Disable automatic updates"), "reenabled state shown");
    writeMatches(2, { enabled: true });
    assert(field("Time").value === "07:40" && field("Timezone").value === "America/New_York", "Reenabling discarded the schedule draft");
    pass("PASS: Enable/disable requests only change activation and retain an unsaved draft.");

    failNextPut = true;
    await press("Save schedule");
    await waitFor(() => writes.length === 4 && button("Save schedule")?.disabled === false, "failed save unlocked");
    writeMatches(3, { time: "07:40", timezone: "America/New_York" });
    assert(stored.time === "06:35" && field("Time").value === "07:40", "Failed save did not retain the draft separately");
    pass("PASS: Failed save retains the draft and can be retried.");

    holdNextGet = true;
    assert(pollSchedule, "Missing the schedule refresh");
    pollSchedule();
    await waitFor(() => pendingGet, "old poll response captured");
    await press("Save schedule");
    await waitFor(() => writes.length === 5 && hasNextCheck(changedNextCheck, "America/New_York"), "retry confirmed new schedule");
    writeMatches(4, { time: "07:40", timezone: "America/New_York" });
    pendingGet!();
    await frame();
    await frame();
    assert(hasNextCheck(changedNextCheck, "America/New_York") && field("Time").value === "07:40", "An older poll overwrote the saved schedule");
    pass("PASS: A late refresh cannot overwrite the confirmed schedule.");
    pass("SCHEDULE_BROWSER_4_OF_4");

    await press("Install update");
    await waitFor(() => button("Install and restart"), "install confirmation opened");
    const dialog = document.querySelector('[role="dialog"]');
    assert(dialog?.textContent?.includes("restarts Metis services"), "Restart was not disclosed before confirmation");
    assert(installs.length === 0, "Opening the confirmation started an installer");
    await press("Cancel");
    await waitFor(() => !button("Install and restart"), "install confirmation cancelled");
    assert(installs.length === 0, "Cancelling sent an install request");
    pass("PASS: The install confirmation discloses restart and cancelling sends no request.");

    await press("Install update");
    const confirm = await waitForConfirm();
    confirm.click();
    confirm.click();
    await waitFor(() => acceptInstall, "synthetic install request received");
    assert(installs.slice().length === 1 && JSON.stringify(installs[0]) === '{"channel":"releases"}', "Expected one latest-stable install request");
    assert(!localStorage.getItem(UPDATE_JOB_STORAGE_KEY), "Maintenance claimed success before the server accepted a job");
    acceptInstall!();
    await waitFor(() => localStorage.getItem(UPDATE_JOB_STORAGE_KEY) === "fixture-install", "accepted job stored");
    pass("PASS: The confirmation sends one correctly scoped install and tracks only an accepted job.");
    pass("INSTALL_BROWSER_2_OF_2");
  } catch (error) {
    output.textContent += `\nFAIL: ${error instanceof Error ? error.message : String(error)}`;
  }
}

if (new URLSearchParams(location.search).has("test")) void checkSchedule();
