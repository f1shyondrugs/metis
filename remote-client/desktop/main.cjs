const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, shell, safeStorage, Notification, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const APP_NAME = "Metis AI Remote Client";
const AUTOSTART_TASK = "Metis AI Remote Client";

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runPowerShell(script) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { encoding: "utf8", windowsHide: true, timeout: 15000 });
  if (result.error || result.status !== 0) throw new Error(result.stderr?.trim() || result.error?.message || "Windows task setting failed");
  return result.stdout.trim();
}

function isElevated() {
  if (process.platform !== "win32") return false;
  return runPowerShell("$identity = [Security.Principal.WindowsIdentity]::GetCurrent(); $principal = [Security.Principal.WindowsPrincipal]::new($identity); $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)") === "True";
}

function getAutostart() {
  if (process.platform !== "win32") return false;
  try {
    return runPowerShell(`$task = Get-ScheduledTask -TaskName ${psQuote(AUTOSTART_TASK)} -ErrorAction SilentlyContinue; [bool]$task`) === "True";
  } catch { return false; }
}

function setAutostart(enabled) {
  if (process.platform !== "win32") return false;
  const taskName = psQuote(AUTOSTART_TASK);
  if (enabled) {
    runPowerShell(`$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name; $action = New-ScheduledTaskAction -Execute ${psQuote(process.execPath)}; $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user; $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest; Register-ScheduledTask -TaskName ${taskName} -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null`);
  } else {
    runPowerShell(`Unregister-ScheduledTask -TaskName ${taskName} -Confirm:$false -ErrorAction SilentlyContinue`);
  }
  return getAutostart();
}
const userDataDir = path.join(app.getPath("appData"), "MetisAI", "RemoteClient");
fs.mkdirSync(userDataDir, { recursive: true });
app.setPath("userData", userDataDir);
let window;
let tray;
let runtime;
let config;
let quitting = false;
let previousConnection = "offline";
const status = { connection: "offline", error: "", update: "" };

function configPath() {
  return path.join(app.getPath("userData"), "config.json");
}

function loadConfig() {
  if (!fs.existsSync(configPath())) return null;
  const saved = JSON.parse(fs.readFileSync(configPath(), "utf8"));
  if (!saved.encryptedCredential || !safeStorage.isEncryptionAvailable()) {
    throw new Error("Windows credential storage is unavailable");
  }
  return {
    server: saved.server,
    clientId: saved.clientId,
    credential: safeStorage.decryptString(Buffer.from(saved.encryptedCredential, "base64")),
  };
}

function saveConfig(next) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Windows credential storage is unavailable");
  }
  const saved = {
    server: next.server,
    clientId: next.clientId,
    encryptedCredential: safeStorage.encryptString(next.credential).toString("base64"),
  };
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(saved), { encoding: "utf8", mode: 0o600 });
}

function publicState() {
  return {
    paired: Boolean(config),
    server: config?.server || "",
    clientId: config?.clientId || "",
    ...status,
  };
}

function broadcast() {
  window?.webContents.send("hub:status", publicState());
  tray?.setToolTip(`${APP_NAME} — ${status.connection}`);
  updateTray();
}

function updateTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Device Hub", click: () => showWindow() },
    { label: `Connection: ${status.connection}`, enabled: false },
    { type: "separator" },
    { label: "Start at login", type: "checkbox", checked: getAutostart(),
      click: (item) => { try { setAutostart(item.checked); } catch (error) { status.error = error.message; broadcast(); } } },
    { label: "Open Metis AI", enabled: Boolean(config), click: () => config && shell.openExternal(config.server) },
    { type: "separator" },
    { label: "Quit", click: () => { quitting = true; app.quit(); } },
  ]));
}

function showWindow() {
  if (!window) createWindow();
  window.show();
  window.focus();
}

function createWindow() {
  window = new BrowserWindow({
    width: 1120,
    height: 740,
    minWidth: 390,
    minHeight: 560,
    title: APP_NAME,
    icon: path.join(__dirname, "assets", "icon.ico"),
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#fafafa",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.loadFile(path.join(__dirname, "index.html"));
  window.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      window.hide();
    }
  });
  window.on("closed", () => { window = null; });
}

async function startRuntime() {
  runtime?.stop();
  runtime = null;
  if (!config) return;
  const module = await import(pathToFileURL(path.join(__dirname, "client.mjs")).href);
  runtime = module.startRemoteClient({
    config,
    configPath: configPath(),
    onEvent(event) {
      if (event.type !== "connection") return;
      previousConnection = status.connection;
      status.connection = event.status;
      status.error = event.error || "";
      if (event.status === "online" && previousConnection === "offline" && Notification.isSupported()) {
        new Notification({ title: APP_NAME, body: "Connection restored" }).show();
      }
      broadcast();
    },
  });
}

async function fetchSnapshot() {
  if (!config) return { client: null, audit: [] };
  const response = await fetch(`${config.server}/api/remote-clients/hub`, {
    headers: {
      "x-metis-client-id": config.clientId,
      Authorization: `Bearer ${config.credential}`,
    },
    signal: AbortSignal.timeout(12_000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Hub request failed (${response.status})`);
  return data;
}

function registerIpc() {
  ipcMain.handle("hub:state", () => publicState());
  ipcMain.handle("hub:snapshot", () => fetchSnapshot());
  ipcMain.handle("hub:pair", async (_event, input) => {
    const server = String(input?.server || "").trim().replace(/\/+$/, "");
    const token = String(input?.token || "").trim();
    let parsed;
    try { parsed = new URL(server); } catch { throw new Error("Enter a valid server URL"); }
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error("Enter a valid HTTP or HTTPS server URL");
    }
    if (!token) throw new Error("Enter the pairing code from Metis AI");
    if (process.platform === "win32" && !isElevated()) throw new Error("Run Metis AI Remote Client as administrator to connect this device");
    const response = await fetch(`${parsed.origin}/api/remote-clients/enroll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        name: os.hostname(),
        hostname: os.hostname(),
        os: `windows ${os.release()}`,
        architecture: os.arch(),
        version: app.getVersion(),
        permissionMode: "admin",
        capabilities: ["user_files", "user_processes", "user_directories", "admin_files", "admin_processes"],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await response.json();
    if (!response.ok || !data.client?.id || !data.credential) {
      throw new Error(data.error || "Pairing failed");
    }
    const next = { server: parsed.origin, clientId: data.client.id, credential: data.credential };
    saveConfig(next);
    config = next;
    status.connection = "connecting";
    status.error = "";
    await startRuntime();
    broadcast();
    return publicState();
  });
  ipcMain.handle("hub:unpair", async () => {
    runtime?.stop();
    runtime = null;
    config = null;
    fs.rmSync(configPath(), { force: true });
    status.connection = "offline";
    status.error = "";
    broadcast();
    return publicState();
  });
  ipcMain.handle("hub:open-server", () => config && shell.openExternal(config.server));
  ipcMain.handle("hub:export", async () => {
    const snapshot = await fetchSnapshot();
    const result = await dialog.showSaveDialog(window, {
      title: "Export command history",
      defaultPath: `metis-remote-commands-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return false;
    fs.writeFileSync(result.filePath, JSON.stringify({ exportedAt: new Date().toISOString(), audit: snapshot.audit }, null, 2), "utf8");
    return true;
  });
  ipcMain.handle("hub:get-autostart", () => getAutostart());
  ipcMain.handle("hub:set-autostart", (_event, value) => {
    const enabled = setAutostart(Boolean(value));
    updateTray();
    return enabled;
  });
  ipcMain.handle("hub:check-updates", async () => {
    if (!app.isPackaged) return "Updates are available in installed builds";
    try {
      await autoUpdater.checkForUpdates();
      return status.update || "Checking for updates";
    } catch (error) {
      status.update = error.message || "Update check failed";
      broadcast();
      return status.update;
    }
  });
}

function setupUpdates() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.on("update-available", () => {
    status.update = "Downloading update";
    broadcast();
  });
  autoUpdater.on("update-not-available", () => {
    status.update = "Up to date";
    broadcast();
  });
  autoUpdater.on("update-downloaded", () => {
    status.update = "Update ready; restart the app to install";
    broadcast();
    if (Notification.isSupported()) new Notification({ title: APP_NAME, body: status.update }).show();
  });
  autoUpdater.on("error", (error) => {
    status.update = error.message || "Update check failed";
    broadcast();
  });
  const check = () => autoUpdater.checkForUpdates().catch(() => undefined);
  setTimeout(check, 20_000);
  setInterval(check, 6 * 60 * 60 * 1000);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());
  app.whenReady().then(async () => {
    app.setAppUserModelId("ai.metis.remoteclient");
    try { config = loadConfig(); } catch (error) { status.error = error.message; }
    if (process.platform === "win32" && app.isPackaged && !isElevated()) {
      dialog.showErrorBox(APP_NAME, "Administrator access is required. Start the app as administrator.");
      app.quit();
      return;
    }
    if (process.platform === "win32" && app.getLoginItemSettings().openAtLogin) {
      app.setLoginItemSettings({ openAtLogin: false, path: process.execPath });
      try { setAutostart(true); } catch (error) { status.error = error.message; }
    }
    registerIpc();
    createWindow();
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, "assets", "icon.ico")));
    updateTray();
    showWindow();
    if (config) {
      try { await startRuntime(); } catch (error) {
        status.connection = "error";
        status.error = error.message;
        broadcast();
      }
    }
    setupUpdates();
  });
  app.on("before-quit", () => {
    quitting = true;
    runtime?.stop();
  });
  app.on("window-all-closed", () => {});
}
