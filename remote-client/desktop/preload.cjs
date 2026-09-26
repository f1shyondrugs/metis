const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("metis", {
  state: () => ipcRenderer.invoke("hub:state"),
  snapshot: () => ipcRenderer.invoke("hub:snapshot"),
  pair: (input) => ipcRenderer.invoke("hub:pair", input),
  unpair: () => ipcRenderer.invoke("hub:unpair"),
  openServer: () => ipcRenderer.invoke("hub:open-server"),
  exportAudit: () => ipcRenderer.invoke("hub:export"),
  getAutostart: () => ipcRenderer.invoke("hub:get-autostart"),
  setAutostart: (value) => ipcRenderer.invoke("hub:set-autostart", value),
  checkUpdates: () => ipcRenderer.invoke("hub:check-updates"),
  onStatus: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("hub:status", listener);
    return () => ipcRenderer.removeListener("hub:status", listener);
  },
});
