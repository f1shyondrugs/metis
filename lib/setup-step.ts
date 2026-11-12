export type SetupStep = "admin" | "complete";

/** Legacy welcome/people/provider records cannot reintroduce removed setup steps.
 * Account existence comes from the server, never from browser progress storage. */
export function resolveSetupStep(hasUsers: boolean, _savedStep?: string | null): SetupStep {
  return hasUsers ? "complete" : "admin";
}
