import assert from "node:assert/strict";
import {mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import test from "node:test";

test("credential launcher accepts explicit trusted-root and isolated deployments without a fixed Node path", {skip:process.platform!=="linux"}, () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "metis-credential-launch-"));
  const record = path.join(root, "arguments.json");
  const executable = path.join(root, "test-node");
  writeFileSync(executable, "#!/usr/bin/python3\nimport json, pathlib, sys\npathlib.Path(" + JSON.stringify(record) + ").write_text(json.dumps(sys.argv[1:]))\nsys.exit(1)\n", {mode:0o700});
  try {
    const launch = (mode, isolation="") => spawnSync("python3", ["services/browser-login/start.py"], {
      encoding:"utf8", timeout:5000,
      env:{PATH:process.env.PATH, STATE_DIRECTORY:root, METIS_BROWSER_LOGIN_NODE:executable,
        METIS_NATIVE_ISOLATION:isolation, METIS_PROTECTED_LOGIN_MODE:mode},
    });
    for (const mode of ["", "unexpected"]) {
      const result = launch(mode);
      assert.notEqual(result.status, 0);
      assert.match(result.stdout+result.stderr, /explicitly enabled Linux credential deployment/);
      assert.equal(existsSync(record), false, "No process may start without a configured mode");
    }
    for (const [mode,isolation] of [["trusted-root",""], ["","1"]]) {
      const result = launch(mode,isolation);
      assert.notEqual(result.status, 0);
      assert.match(result.stdout+result.stderr, /Protected browser engine did not start/);
      const args = JSON.parse(readFileSync(record,"utf8"));
      assert.deepEqual(args.slice(0,3), ["--disable-sigusr1","--import","tsx"]);
      assert.ok(args[3].endsWith("/services/browser-login/server.ts"));
      rmSync(record);
    }
  } finally { rmSync(root,{recursive:true,force:true}); }
});
