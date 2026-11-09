import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file: string) => readFileSync(new URL("../" + file, import.meta.url), "utf8");

test("enrollment gives users the public GitHub installer URL", () => {
  const enrollment = read("app/api/remote-clients/route.ts");
  const installer = read("app/api/remote-clients/windows-installer/route.ts");
  assert.match(enrollment, /installerUrl: await latestWindowsInstallerUrl\(\)/);
  assert.match(installer, /isAuthenticated\(req\)/);
  assert.match(installer, /Response\.redirect\(await latestWindowsInstallerUrl\(\), 302\)/);
});

test("existing paired clients can update through authenticated server proxy", () => {
  const update = read("app/api/remote-clients/windows-updates/[filename]/route.ts");
  const release = read("lib/remote-client-release.ts");
  assert.match(update, /authenticateRemoteClient/);
  assert.match(update, /legacyWindowsUpdate\(filename\)/);
  assert.match(release, /github\.com\/f1shyondrugs\/Metis-Apps\/releases\/latest\/download\//);
  assert.doesNotMatch(release, /x-metis-client-id/);
});
