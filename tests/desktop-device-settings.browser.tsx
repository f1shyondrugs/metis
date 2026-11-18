// Bundle with esbuild (jsx=automatic) and open on an isolated fixture origin.
// ?mode=desktop exercises the app bridge; ?mode=error exercises failure + retry.
// ?placement=install renders the actual actions from the pairing dialog.
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { DesktopDeviceSettings, RemoteClientInstallActions } from "../components/desktop-device-settings";
import { Button } from "../components/ui/button";
const params = new URLSearchParams(location.search);
const mode = params.get("mode") || "browser";
const install = params.get("placement") === "install";
const installers = params.get("os") === "macos"
  ? [{ url: "/mac-arm64", label: "macOS Apple Silicon" }, { url: "/mac-x64", label: "macOS Intel" }]
  : [{ url: "/windows", label: "Windows" }];
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
  if (install) return <main className="mx-auto mt-8 box-border w-[calc(100vw_-_2rem)] space-y-5 rounded-2xl border bg-background p-6" style={{ maxWidth: "56rem" }}>
    <header><h1 className="text-lg font-medium">Connect a remote client</h1><p className="mt-1 text-sm text-muted-foreground">Pair a device with this account and keep it available for terminal sessions.</p></header>
    <section className="space-y-4 rounded-xl border border-border/60 bg-muted/20 p-4" aria-label="Install step">
      <h2 className="text-sm font-medium">Install the {params.get("os") === "macos" ? "macOS" : "Windows"} app</h2>
      <p className="text-xs text-muted-foreground">Install Metis, open Metis → Device settings, then enter this server URL and pairing code.</p>
      <RemoteClientInstallActions installers={installers} />
      <p className="text-xs text-muted-foreground">Waiting for the device to connect…</p>
    </section>
    <pre id="results" role="status" className="whitespace-pre-wrap text-xs text-muted-foreground">{ready ? "Checking…" : "Loading…"}</pre>
  </main>;
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
  const expectedLabel = install ? "Open Remote Client Settings" : "Open Remote Client Device Settings";
  const button = () => Array.from(document.querySelectorAll("button")).find(item => item.textContent?.trim() === expectedLabel || item.textContent?.trim() === "Opening…");
  check(Boolean(button()) === (mode !== "browser"), "desktop action appears only when the native bridge exists");
  if (install) {
    const downloads = Array.from(document.querySelectorAll<HTMLAnchorElement>('[aria-label="Install step"] a'));
    check(downloads.length === installers.length && downloads.every((link, index) =>
      link.getAttribute("href") === installers[index].url && link.target === "_blank" &&
      link.relList.contains("noopener") && link.textContent?.trim() === `Download ${installers[index].label}`
    ), "each installer remains downloadable");
    const settings = button();
    const lastDownload = downloads.at(-1);
    if (settings && lastDownload) {
      check(settings.parentElement?.parentElement === lastDownload.parentElement &&
        Boolean(lastDownload.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING),
      "settings follows the downloads in the same group");
      const group = lastDownload.parentElement!;
      const row = group.getBoundingClientRect();
      const last = settings.getBoundingClientRect();
      const gap = Number.parseFloat(getComputedStyle(group).columnGap) || 0;
      const rectangles = downloads.map(link => link.getBoundingClientRect());
      const fits = rectangles.reduce((total, rect) => total + rect.width + gap, last.width) <= row.width;
      check(last.right <= row.right + 1 && last.left >= row.left - 1 &&
        (fits ? last.top === rectangles[0].top : last.top >= rectangles.at(-1)!.top),
      "button stays within the group and wraps only when needed");
    }
  }
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
  const payload = { mode, placement: install ? "install" : "overview", width: innerWidth, passed: !document.body.dataset.failed, results };
  document.body.dataset.complete = "true";
  await fetch("/result", { method: "POST", body: JSON.stringify(payload) });
})();
