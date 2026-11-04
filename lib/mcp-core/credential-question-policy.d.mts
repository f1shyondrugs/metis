export const SECURE_CREDENTIAL_INSTRUCTIONS: string;
export const CREDENTIAL_QUESTION_ERROR: string;
export const PROTECTED_CREDENTIAL_INPUT_MESSAGE: string;
export class CredentialQuestionError extends Error {
  readonly code: "protected_credentials_required";
  constructor();
}
export function requiresProtectedCredentials(input: unknown): boolean;
export const requiresProtectedCredentialInput: typeof requiresProtectedCredentials;
export function assertOrdinaryQuestionSafe(input: unknown): void;
