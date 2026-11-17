import test from "node:test";
import assert from "node:assert/strict";
import {sanitizePackageDiagnostics} from "../lib/package-update-diagnostics";
test("package diagnostics export only allowlisted metadata",()=>{
  const input={tag:"v1.2.3",platform:"linux",arch:"x64",secret:"PRIVATE",
    events:[{time:"2026-11-17T12:00:00.000Z",phase:"failed",code:"DISK_FULL",token:"PRIVATE",url:"https://private.test"},
      {time:"invalid PRIVATE",phase:"failed"},{time:"2026-11-17T12:00:00.000Z",phase:"arbitrary PRIVATE"}]};
  const report=sanitizePackageDiagnostics(input);
  assert.equal(report.events.length,1);assert.equal(report.events[0].code,"DISK_FULL");
  assert.ok(!JSON.stringify(report).includes("PRIVATE"));
  assert.ok(!JSON.stringify(report).includes("private.test"));
});
