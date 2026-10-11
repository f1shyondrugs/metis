export type SettingsSection = { id: string; label: string; keywords?: string };
export const SETTINGS_SECTIONS: Record<string, SettingsSection[]> = {
  general: [
    { id: "settings-subagent-model", label: "Subagent model", keywords: "delegation standard model modell unteragent" },
    { id: "settings-token-compression", label: "Token compression", keywords: "context tool results chat history rtk caveman kompression kontext" },
    { id: "settings-notifications", label: "Notifications", keywords: "sound cues finish sound custom audio browser push remote client toasts benachrichtigungen ton" },
    { id: "settings-voice-input", label: "Voice input", keywords: "microphone recording transcription speech dictation api key realtime mikrofon sprache diktat" },
    { id: "settings-dictionary", label: "Dictionary", keywords: "voice words spellings worter wörter worterbuch wörterbuch" },
    { id: "settings-browser", label: "Browser", keywords: "realtime preview stream fps viewport width height echtzeit breite hohe höhe" },
    { id: "settings-browser-storage", label: "Browser storage", keywords: "cookies persistent website sessions localstorage sessionstorage speicher sitzungen" },
    { id: "settings-session", label: "Session", keywords: "lock screen sign out logout sperren abmelden" },
    { id: "settings-links", label: "Links", keywords: "website github source code webseite quellcode" },
  ],
  models: [
    { id: "settings-usage", label: "Usage", keywords: "quota cost limits tokens plan verbrauch kosten kontingent" },
    { id: "settings-providers", label: "Providers", keywords: "ai connections api key oauth credentials anbieter verbindungen schlüssel" },
    { id: "settings-versions", label: "Versions", keywords: "cli installed version update versionen" },
  ],
  agent: [
    { id: "settings-agent-runtime", label: "Settings", keywords: "runtime unlimited minutes subagents project agents provider limits reset recovery laufzeit zeitlimit warten" },
    { id: "settings-skills", label: "Skills", keywords: "instructions packages installed fähigkeiten anweisungen" },
    { id: "settings-modes", label: "Agent modes", keywords: "permissions tool categories modes modi berechtigungen" },
    { id: "settings-mcp", label: "MCP servers", keywords: "tools integrations registry endpoints server werkzeuge integrationen" },
    { id: "settings-memories", label: "Memories", keywords: "global memory facts preferences erinnerungen gedächtnis" },
    { id: "settings-agent-rules", label: "Agent Rules", keywords: "instructions behavior response rules regeln anweisungen" },
  ],
  devices: [
    { id: "settings-remote-clients", label: "Remote clients", keywords: "devices pairing desktop pc windows linux macos permissions geräte verbinden" },
  ],
  admin: [
    { id: "settings-users", label: "Users", keywords: "accounts passwords access benutzer konten passwort" },
    { id: "settings-archived", label: "Archived chats", keywords: "restore archive archiv wiederherstellen" },
    { id: "settings-shared", label: "Shared chats", keywords: "sharing public links teilen freigaben" },
    { id: "settings-maintenance", label: "Maintenance", keywords: "reset metis delete cleanup wartung zurücksetzen löschen" },
  ],
};

export const SETTINGS_TABS = [
  { value: "general", label: "General", keywords: "allgemein" },
  { value: "models", label: "Models", keywords: "modelle" },
  { value: "agent", label: "Agent" },
  { value: "devices", label: "Devices", keywords: "geräte" },
  { value: "admin", label: "Admin" },
  { value: "updates", label: "Updates", keywords: "automatic schedule channel stable beta releases aktualisierung automatisch zeitplan" },
] as const;

export function visibleSettingsSections(tab: string, isHostAdmin: boolean) {
  return (SETTINGS_SECTIONS[tab] || []).filter(item =>
    isHostAdmin || (item.id !== "settings-users" && item.id !== "settings-maintenance"),
  );
}

export type SettingsSearchEntry = {
  id: string;
  tab: string;
  label: string;
  category: string;
  keywords?: string;
  sectionId?: string;
};

export function settingsSearchEntries(isHostAdmin: boolean): SettingsSearchEntry[] {
  return SETTINGS_TABS.flatMap(tab => {
    const category = tab.value === "admin" && !isHostAdmin ? "Chats" : tab.label;
    return [
      { id: tab.value, tab: tab.value, label: category, category: "Settings", keywords: "keywords" in tab ? tab.keywords : undefined },
      ...visibleSettingsSections(tab.value, isHostAdmin).map(item => ({
        id: item.id, tab: tab.value, sectionId: item.id, label: item.label, category, keywords: item.keywords,
      })),
    ];
  });
}

function normalize(value: string) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase().trim();
}

export function searchSettings(entries: readonly SettingsSearchEntry[], query: string): SettingsSearchEntry[] {
  const normalized = normalize(query);
  const terms = normalized.split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return entries
    .map((entry, order) => {
      const label = normalize(entry.label);
      const text = normalize([entry.label, entry.category, entry.keywords].filter(Boolean).join(" "));
      const score = label === normalized ? 0 : label.startsWith(normalized) ? 1 : label.includes(normalized) ? 2 : 3;
      return { entry, order, score, matches: terms.every(term => text.includes(term)) };
    })
    .filter(item => item.matches)
    .sort((a, b) => a.score - b.score || a.order - b.order)
    .map(item => item.entry);
}
