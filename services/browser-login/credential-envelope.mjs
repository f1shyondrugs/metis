import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Preserve the v1 envelope and AAD used by existing saved browser logins.
export function seal(key, owner, credentialId, payload) {
  const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(JSON.stringify(['metis-vault-v1', owner, credentialId])));
  const plaintext = Buffer.from(JSON.stringify(payload));
  try {
    const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return JSON.stringify({ v: 1, nonce: nonce.toString('base64'), data: data.toString('base64'), tag: cipher.getAuthTag().toString('base64') });
  } finally { plaintext.fill(0); }
}

export function unseal(key, owner, credentialId, encoded) {
  const e = JSON.parse(encoded);
  if (e.v !== 1) throw new Error('Invalid envelope');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(e.nonce, 'base64'), { authTagLength: 16 });
  decipher.setAAD(Buffer.from(JSON.stringify(['metis-vault-v1', owner, credentialId])));
  decipher.setAuthTag(Buffer.from(e.tag, 'base64'));
  const plain = Buffer.concat([decipher.update(Buffer.from(e.data, 'base64')), decipher.final()]);
  try { return JSON.parse(plain.toString()); } finally { plain.fill(0); }
}
