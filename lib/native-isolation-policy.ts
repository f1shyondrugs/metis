/** Operator opt-in, shared by the app and worker. Never supplied by a model. */
export function nativeIsolationEnabled(): boolean {
  return process.env.METIS_NATIVE_ISOLATION === "1";
}

/** An operator chooses the host trust model; this never comes from a chat request. */
export function protectedLoginMode(): "isolated" | "trusted-root" | null {
  if (nativeIsolationEnabled()) return "isolated";
  return process.env.METIS_PROTECTED_LOGIN_MODE === "trusted-root" ? "trusted-root" : null;
}

/** Credential services also support operators who deliberately retain root execution. */
export function requireProtectedLoginIsolation(): void {
  if (process.platform !== "linux" || !protectedLoginMode()) {
    throw new Error("Protected logins require an explicitly enabled Linux credential deployment (isolated or trusted-root).");
  }
}
