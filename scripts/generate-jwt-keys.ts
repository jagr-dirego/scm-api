import { generateKeyPairSync } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';

const environmentPath = resolve('.env');
const temporaryPath = `${environmentPath}.tmp`;
const current = existsSync(environmentPath)
  ? readFileSync(environmentPath, 'utf8')
  : '';

if (/^NODE_ENV=production\s*$/m.test(current)) {
  throw new Error(
    'Local JWT key generation is disabled for production environments',
  );
}

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 3072,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const keyId = `local-${new Date().toISOString().slice(0, 10)}`;
const values: Record<string, string> = {
  JWT_ISSUER: 'http://localhost:3000',
  JWT_AUDIENCE: 'dirego-scm',
  JWT_ACCESS_TTL_SECONDS: '600',
  JWT_SIGNING_KEY_ID: keyId,
  JWT_PRIVATE_KEY_B64: Buffer.from(privateKey).toString('base64'),
  JWT_PUBLIC_KEYS_JSON: JSON.stringify({
    [keyId]: Buffer.from(publicKey).toString('base64'),
  }),
  SESSION_IDLE_TTL_SECONDS: '28800',
  SESSION_ABSOLUTE_TTL_SECONDS: '2592000',
  REFRESH_COOKIE_NAME: 'dirego_refresh',
  REFRESH_COOKIE_SECURE: 'false',
};

let updated = current.trimEnd();
for (const [name, value] of Object.entries(values)) {
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, 'm');
  updated = pattern.test(updated)
    ? updated.replace(pattern, line)
    : `${updated}${updated ? '\n' : ''}${line}`;
}

writeFileSync(temporaryPath, `${updated}\n`, { encoding: 'utf8', mode: 0o600 });
renameSync(temporaryPath, environmentPath);
try {
  chmodSync(environmentPath, 0o600);
} catch {
  // Windows ACLs are managed by the host; Git exclusion remains mandatory.
}

process.stdout.write(
  'Local JWT configuration generated in .env without printing key material.\n',
);
