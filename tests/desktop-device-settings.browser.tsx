// Bundle with esbuild (jsx=automatic) and open on an isolated fixture origin.
// ?mode=desktop exercises the app bridge; ?mode=error exercises failure + retry.
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { DesktopDeviceSettings } from "../components/desktop-device-settings";
import { Button } from "../components/ui/button";
const mode = new URLSearchParams(location.search).get("mode") || "browser";
let calls = 0;
if (mode !== "browser") {
  Object.defineProperty(window, "metisApp", { value: Object.freeze({
    openDeviceSettings: async () => {
      calls++;
      await new Promise(resolve => setTimeout(resolve, 160));
      if (mode === "error" && calls === 1) throw Error("Fixture open failed");
    }
  }) });
}
const results: string[] = [];
function check(value: unknown, label: string) {
  results.push((value ? "PASS " : "FAIL ") + label);
  document.getElementById("results")!.textContent = results.join("\n");
  if (!value) document.body.dataset.failed = "true";
}
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function Fixture() {
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);
  return <main className="mx-auto w-full max-w-3xl p-4 md:p-6">
    <header className="mb-8 flex items-center gap-3"><strong className="text-xl">Metis</strong></header>
    <section className="flex flex-col gap-5" aria-label="Remote clients">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-sm font-medium">Remote Clients</h1><p className="mt-1 max-w-2xl text-xs text-muted-foreground">Clients use an outbound encrypted connection. New clients start in user access; administrative capabilities are never implicit.</p></div>
        <div className="flex flex-wrap items-start gap-2"><DesktopDeviceSettings/><Button size="action">Add client</Button></div>
      </div>
      <p className="text-xs text-muted-foreground">No devices in this isolated preview.</p>
    </section>
    <pre id="results" role="status" className="mt-10 whitespace-pre-wrap text-xs text-muted-foreground">{ready ? "Checking…" : "Loading…"}</pre>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
void (async () => {
  await pause(350);
  const button = () => Array.from(document.querySelectorAll("button")).find(item => /Open device settings|Opening/.test(item.textContent || ""));
  check(Boolean(button()) === (mode !== "browser"), "desktop action appears only when the native bridge exists");
  if (mode !== "browser") {
    button()!.click(); await pause(40);
    check(button()!.disabled, "opening state prevents repeated actions");
    await pause(180);
    if (mode === "error") {
      check(Boolean(document.querySelector('[role="alert"]')), "failed opening has an accessible error");
      button()!.click(); await pause(220);
      check(!document.querySelector('[role="alert"]'), "retry clears the error");
    }
    check(calls === (mode === "error" ? 2 : 1), "button invokes only the device-settings action");
    check(!button()!.disabled, "action recovers after completion");
  }
  check(document.documentElement.scrollWidth <= innerWidth, "no horizontal overflow");
  const payload = { mode, width: innerWidth, passed: !document.body.dataset.failed, results };
  document.body.dataset.complete = "true";
  await fetch("/result", { method: "POST", body: JSON.stringify(payload) });
})();
