const byId = (id) => document.getElementById(id);
const state = { paired: false, clientId: "", connection: "offline", client: null, audit: [], selectedLog: "", loaded: false, fetching: false };

function formatDate(value) {
  if (!value) return "Never";
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? "Unknown" : time.toLocaleString();
}

function formatShortDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString();
}

function node(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value != null) element.textContent = String(value);
  return element;
}

function setConnection(data) {
  Object.assign(state, data);
  byId("pair-view").hidden = state.paired;
  byId("hub-view").hidden = !state.paired;
  byId("open-server").hidden = !state.paired;
  byId("connection-label").textContent = state.connection.charAt(0).toUpperCase() + state.connection.slice(1);
  byId("connection-dot").className = `status-dot ${state.connection}`;
  byId("device-status").textContent = state.connection.charAt(0).toUpperCase() + state.connection.slice(1);
  byId("device-status").className = `device-state ${state.connection}`;
  byId("update-label").textContent = data.update || "";
  if (data.error && state.paired) showHubError(data.error);
  if (data.error && !state.paired) {
    byId("pair-error").textContent = data.error;
    byId("pair-error").hidden = false;
  }
}

function showHubError(message) {
  const element = byId("hub-error");
  element.textContent = message;
  element.hidden = !message;
}

function filteredAudit() {
  const search = byId("search").value.trim().toLowerCase();
  const status = byId("status-filter").value;
  return state.audit.filter((entry) => {
    if (entry.clientId !== state.clientId) return false;
    if (status !== "all" && entry.status !== status) return false;
    return !search || `${entry.action} ${entry.requestData?.command || ""}`.toLowerCase().includes(search);
  });
}

function renderCommands() {
  const list = byId("commands-list");
  list.replaceChildren();
  byId("commands-loading").hidden = true;
  const items = filteredAudit();
  if (!items.length) {
    list.append(node("p", "empty", state.audit.length ? "No commands match these filters." : "No commands have run on this PC yet."));
    byId("command-detail").hidden = true;
    return;
  }
  for (const entry of items) {
    const row = node("button", `command-row ${state.selectedLog === entry.id ? "selected" : ""}`);
    row.type = "button";
    const name = entry.requestData?.command || entry.action;
    row.append(
      node("span", "when", formatShortDate(entry.createdAt)),
      node("span", "command-name", name),
      node("span", `badge ${entry.status}`, entry.status === "unknown" ? "Unclear" : entry.status),
    );
    row.addEventListener("click", () => selectLog(entry.id));
    list.append(row);
  }
}

function detailField(parent, title, value) {
  if (value == null || value === "") return;
  parent.append(node("h3", "", title), node("pre", "", typeof value === "string" ? value : JSON.stringify(value, null, 2)));
}

function selectLog(id) {
  state.selectedLog = id;
  renderCommands();
  const entry = state.audit.find((item) => item.id === id);
  const detail = byId("command-detail");
  detail.replaceChildren();
  if (!entry) {
    detail.hidden = true;
    return;
  }
  detail.hidden = false;
  const heading = node("div", "detail-heading");
  heading.append(node("strong", "", entry.action));
  const close = node("button", "text-button", "Close");
  close.type = "button";
  close.addEventListener("click", () => {
    state.selectedLog = "";
    detail.hidden = true;
    renderCommands();
  });
  heading.append(close);
  detail.append(heading);
  detail.append(node("p", "detail-meta", `${entry.status} · ${formatDate(entry.createdAt)}${entry.durationMs != null ? " · " + entry.durationMs + " ms" : ""} · ${entry.source}`));
  if (entry.error) detailField(detail, "Error", entry.error);
  if (entry.requestData && Object.keys(entry.requestData).length) detailField(detail, "Request", entry.requestData);
  if (entry.resultData && Object.keys(entry.resultData).length) detailField(detail, "Result", entry.resultData);
  if (entry.status === "unknown") detailField(detail, "Outcome", "The connection ended before Metis AI received a result. The command may have run. Check this PC before retrying.");
}

async function refresh() {
  if (!state.paired || state.fetching) return;
  state.fetching = true;
  try {
    const data = await window.metis.snapshot();
    state.client = data.client?.id === state.clientId ? data.client : null;
    state.audit = Array.isArray(data.audit) ? data.audit.filter((entry) => entry.clientId === state.clientId) : [];
    state.loaded = true;
    showHubError("");
    byId("device-name").textContent = state.client?.name || state.client?.hostname || "This Windows PC";
    byId("device-meta").textContent = [state.client?.os || "Windows", state.client?.version ? `v${state.client.version}` : null, "Administrator access"].filter(Boolean).join(" · ");
    byId("device-seen").textContent = state.client?.lastSeenAt ? `Last seen ${formatDate(state.client.lastSeenAt)}` : "";
    byId("sync-label").textContent = `Updated ${new Date().toLocaleTimeString()}`;
    renderCommands();
    if (state.selectedLog) selectLog(state.selectedLog);
  } catch (error) {
    showHubError(error.message || "Could not load this device's activity");
    byId("sync-label").textContent = "Could not sync this device";
    if (!state.loaded) byId("commands-loading").textContent = "Command history unavailable.";
  } finally {
    state.fetching = false;
  }
}

async function initialize() {
  if (!window.metis) {
    byId("pair-error").textContent = "Desktop integration is unavailable. Restart the app.";
    byId("pair-error").hidden = false;
    return;
  }
  try {
    setConnection(await window.metis.state());
    byId("autostart").checked = await window.metis.getAutostart();
    if (state.paired) await refresh();
  } catch (error) {
    byId("pair-error").textContent = error.message || "Could not initialize the app";
    byId("pair-error").hidden = false;
  }
  window.metis.onStatus((data) => {
    const wasPaired = state.paired;
    setConnection(data);
    if (!wasPaired && state.paired) void refresh();
  });
}

byId("pair-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = byId("pair-button");
  button.disabled = true;
  byId("pair-error").hidden = true;
  try {
    const data = await window.metis.pair({ server: byId("server").value, token: byId("token").value });
    byId("token").value = "";
    setConnection(data);
    await refresh();
  } catch (error) {
    byId("pair-error").textContent = error.message || "Pairing failed";
    byId("pair-error").hidden = false;
  } finally {
    button.disabled = false;
  }
});
byId("refresh").addEventListener("click", () => void refresh());
byId("export").addEventListener("click", async () => {
  try { await window.metis.exportAudit(); }
  catch (error) { showHubError(error.message || "Could not export logs"); }
});
byId("search").addEventListener("input", renderCommands);
byId("status-filter").addEventListener("change", renderCommands);
byId("open-server").addEventListener("click", () => void window.metis.openServer());
byId("autostart").addEventListener("change", async (event) => {
  try { event.target.checked = await window.metis.setAutostart(event.target.checked); }
  catch (error) { showHubError(error.message || "Could not change login setting"); event.target.checked = !event.target.checked; }
});
byId("check-updates").addEventListener("click", async () => {
  byId("more-menu").open = false;
  byId("update-label").textContent = await window.metis.checkUpdates();
});
byId("unpair").addEventListener("click", async () => {
  byId("more-menu").open = false;
  if (!window.confirm("Disconnect this device from Metis AI? You can pair it again from Settings → Devices.")) return;
  setConnection(await window.metis.unpair());
  state.client = null;
  state.audit = [];
  state.loaded = false;
});
setInterval(() => void refresh(), 5_000);
void initialize();
