export type SetupStep = "admin" | "public-url";

/** Only server account existence advances the setup beyond account creation. */
export function resolveSetupStep(hasUsers: boolean, _savedStep?: string | null): SetupStep {
  return hasUsers ? "public-url" : "admin";
}
