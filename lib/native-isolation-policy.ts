/** Operator opt-in, shared by the app and worker. Never supplied by a model. */
export function nativeIsolationEnabled(): boolean {
  return process.env.METIS_NATIVE_ISOLATION === "1";
}

/** A protected credential deployment may never use the legacy execution path. */
export function requireProtectedLoginIsolation(): void {
  if (!nativeIsolationEnabled() || process.platform !== "linux") {
    throw new Error("Protected logins require an explicitly enabled Linux isolation deployment.");
  }
}
