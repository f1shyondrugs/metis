#!/usr/bin/env -S node --import tsx
/**
 * Offline registry inventory. Deliberately has no owner-ID, credential or paid
 * execution option. Authenticated live tests belong to /provider-acceptance.
 */
import { mkdirSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { listProviderDefinitions } from "../lib/providers/registry";
import { buildAcceptanceMatrix, renderAcceptanceMarkdown, renderAcceptanceHtml, summarizeAcceptanceReport, type AcceptanceReport } from "../lib/providers/acceptance";

const { values } = parseArgs({ options: { out: { type: "string" }, strict: { type: "boolean", default: false }, help: { type: "boolean", default: false } } });
if (values.help) {
  console.log("Usage: pnpm acceptance:providers --out <directory> [--strict]\nOffline only: no database, credentials or network. --strict exits 1 unless full live acceptance is proven (catalog reports never qualify).\nOpen /provider-acceptance while signed in for explicitly budgeted live tests.");
} else {
  const providers = listProviderDefinitions();
  const timestamp = new Date().toISOString();
  const report: AcceptanceReport = { schemaVersion: 1, id: randomUUID(), createdAt: timestamp, updatedAt: timestamp,
    mode: "catalog", state: "planned", revision: "registry:" + createHash("sha256").update(JSON.stringify(providers)).digest("hex").slice(0, 20),
    targets: buildAcceptanceMatrix({ providers }), limits: { maxTurns: 0, timeoutMs: 0 }, turnsUsed: 0,
    notes: ["Offline registry inventory only. No database, account metadata, credentials, discovery or provider API was accessed.",
      "No matching account connections were supplied. Blocked is not passed. Live model availability and capabilities remain unverified.",
      "Use the authenticated /provider-acceptance console to choose exact accounts/models/checks and explicitly authorize bounded live tests."] };
  const output = path.resolve(values.out || path.join("outputs", "provider-acceptance", report.id));
  mkdirSync(output, { recursive: true, mode: 0o700 });
  for (const [name, content] of [["report.json", JSON.stringify(report, null, 2) + "\n"], ["report.md", renderAcceptanceMarkdown(report)], ["report.html", renderAcceptanceHtml(report)]]) {
    const destination = path.join(output, name);
    const temp = destination + "." + randomUUID() + ".tmp";
    writeFileSync(temp, content, { mode: 0o600, flag: "wx" });
    renameSync(temp, destination);
  }
  const summary = summarizeAcceptanceReport(report);
  console.log(JSON.stringify({ mode: report.mode, providers: providers.length, authenticationPaths: providers.reduce((n, p) => n + p.authTypes.length, 0),
    targets: report.targets.length, turnsUsed: report.turnsUsed, ...summary, output }, null, 2));
  if (values.strict && !summary.releaseReady) process.exitCode = 1;
}
