import { getAppearanceSettings } from "./appearance-settings";
import { createDefaultAppearanceState, getSelectedTheme } from "./appearance-storage";
import { resolveThemeVariables } from "./appearance-theme";

/** Only the selected, validated account theme crosses the device connection. */
export function getRemoteClientAppearance(ownerId: string) {
  const record = getAppearanceSettings(ownerId);
  const theme = getSelectedTheme(record.state ?? createDefaultAppearanceState());
  return { version: 1 as const, revision: record.revision, mode: theme.mode, variables: resolveThemeVariables(theme) };
}
