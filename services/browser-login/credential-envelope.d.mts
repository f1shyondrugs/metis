export function seal(key: Buffer, owner: string, credentialId: string, payload: unknown): string;
export function unseal(key: Buffer, owner: string, credentialId: string, encoded: string): unknown;
