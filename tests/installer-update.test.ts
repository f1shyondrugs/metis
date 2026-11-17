import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildInstallerUpdatePlan, installerLogIndicatesFailure, installerLogIndicatesSuccess, installerSystemdEnvironment, installerUpdateScriptPath } from "../lib/installer-update";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const base = {
  root,
  serviceName: "metis-ai",
  dataDir: path.join(root, "data"),
};

test("capable native installs use prebuilt packages on each supported OS", () => {
  for(const platform of ["linux","darwin","win32"] as const){
    const plan=buildInstallerUpdatePlan({...base,installDir:"/stable/install",docker:false,channel:"releases",tag:"v1.2.3",platform,packageUpdates:true,repository:"f1shyondrugs/metis"});
    assert.equal(plan.kind,"package");
    assert.equal(plan.command,process.execPath);
    assert.ok(plan.args.includes("/stable/install"));
    assert.ok(plan.args.includes("f1shyondrugs/metis"));
    assert.equal(plan.args.includes("--native"),false);
    assert.match(plan.scriptSource,/package-update-runner.mjs$/);
  }
  assert.throws(()=>buildInstallerUpdatePlan({...base,docker:false,channel:"releases",tag:"../unsafe",packageUpdates:true}),/Invalid release/);
});

test("native Linux settings updates run linux.sh non-interactively", () => {
  const plan = buildInstallerUpdatePlan({
    ...base,
    docker: false,
    channel: "releases",
    tag: "v1.0.5",
    platform: "linux",
  });
  assert.equal(plan.kind, "native");
  assert.equal(plan.command, "/bin/bash");
  assert.equal(plan.scriptSource, path.join(root, "install", "linux.sh"));
  assert.deepEqual(plan.args, [
    plan.scriptSource,
    "--non-interactive",
    "--native",
    "--install-dir",
    root,
    "--service-name",
    "metis-ai",
    "--version",
    "v1.0.5",
  ]);
  assert.equal(plan.unitName, "metis-ai-self-update");
});

test("native commit updates omit --version so the installer selects the requested dev commit", () => {
  const plan = buildInstallerUpdatePlan({
    ...base,
    docker: false,
    channel: "commits",
    tag: "v1.0.5",
    platform: "linux",
  });
  assert.equal(plan.args.includes("--version"), false);
});

test("native commit plans pin the selected SHA with --commit", () => {
  const plan = buildInstallerUpdatePlan({
    ...base,
    docker: false,
    channel: "commits",
    commit: "abcdef1234567890",
    platform: "linux",
  });
  assert.equal(plan.args.includes("--commit"), true);
  assert.equal(plan.args.includes("abcdef1234567890"), true);
  assert.equal(plan.args.includes("--version"), false);
});

test("legacy container updates stop before planning a native migration", () => {
  assert.throws(() => buildInstallerUpdatePlan({
    ...base, docker: true, channel: "releases", tag: "v1.0.21", platform: "linux",
  }), /separate directory.*migrate your data separately/);
});

test("macOS and Windows plans use the platform installer files", () => {
  const mac = buildInstallerUpdatePlan({
    ...base,
    docker: false,
    channel: "releases",
    tag: "v1.0.5",
    platform: "darwin",
  });
  assert.equal(mac.scriptSource, path.join(root, "install", "macos.sh"));
  assert.equal(mac.unitName, undefined);

  const win = buildInstallerUpdatePlan({
    ...base,
    docker: false,
    channel: "releases",
    tag: "v1.0.5",
    platform: "win32",
  });
  assert.equal(win.command, "powershell.exe");
  assert.equal(win.scriptSource, path.join(root, "install", "windows.ps1"));
  assert.equal(win.args.includes("-Version"), true);
  assert.equal(win.args.includes("v1.0.5"), true);
});

test("copied installer scripts stay in dataDir, not systemd PrivateTmp", () => {
  const dest = installerUpdateScriptPath("/var/lib/metis/data", path.join(root, "install", "linux.sh"));
  assert.equal(dest, path.join("/var/lib/metis/data", "metis-ai-update-run.sh"));
  assert.equal(dest.includes("/tmp/"), false);
});

test("systemd-run environment carries Node and pnpm from an existing install", { skip: process.platform === "win32" }, () => {
  const args = installerSystemdEnvironment(
    { PATH: "/bin", USER: "root", NODE_ENV: "test", METIS_NODE_HOME: "/opt/node", METIS_PNPM_HOME: "/opt/pnpm/bin" },
    "/opt/metis",
  );
  assert.equal(args.some((value) => value.startsWith("--setenv=HOME=") && value.length > "--setenv=HOME=".length), true);
  assert.equal(args.includes("--setenv=USER=root"), true);
  const pathArg = args.find((value) => value.startsWith("--setenv=PATH="));
  assert.ok(pathArg);
  const dirs = pathArg.slice("--setenv=PATH=".length).split(path.delimiter);
  assert.ok(dirs.includes("/opt/node/bin"));
  assert.ok(dirs.includes("/opt/pnpm/bin"));
  assert.ok(dirs.includes("/opt/metis/.runtime/node/bin"));
  assert.ok(dirs.includes("/opt/metis/.runtime/pnpm/bin"));
  assert.ok(dirs.includes("/bin"));
});

test("installer logs detect the HOME unbound failure", () => {
  assert.equal(installerLogIndicatesFailure("/tmp/metis-ai-update.sh: line 9: HOME: unbound variable"), true);
  assert.equal(installerLogIndicatesFailure("Error: git pull failed"), true);
  assert.equal(installerLogIndicatesFailure("Installing packages..."), false);
});

test("installer logs detect a finished native install", () => {
  assert.equal(installerLogIndicatesSuccess("Metis AI installed successfully."), true);
  assert.equal(installerLogIndicatesSuccess("Installing packages..."), false);
});
