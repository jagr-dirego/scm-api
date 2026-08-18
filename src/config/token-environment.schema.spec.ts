import { generateKeyPairSync } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseTokenEnvironment } from './token-environment.schema';

let privateKeyBase64: string;
let publicKeyBase64: string;

beforeAll(() => {
  const keys = generateKeyPairSync('rsa', {
    modulusLength: 3072,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  privateKeyBase64 = Buffer.from(keys.privateKey).toString('base64');
  publicKeyBase64 = Buffer.from(keys.publicKey).toString('base64');
});

const environment = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  NODE_ENV: 'test',
  JWT_ISSUER: 'https://api.dirego.test',
  JWT_AUDIENCE: 'dirego-scm',
  JWT_SIGNING_KEY_ID: 'test-key-1',
  JWT_PRIVATE_KEY_B64: privateKeyBase64,
  JWT_PUBLIC_KEYS_JSON: JSON.stringify({ 'test-key-1': publicKeyBase64 }),
  ...overrides,
});

describe('parseTokenEnvironment', () => {
  it('uses the approved access and session defaults', () => {
    expect(parseTokenEnvironment(environment())).toMatchObject({
      accessTtlSeconds: 600,
      sessionIdleTtlSeconds: 28_800,
      sessionAbsoluteTtlSeconds: 2_592_000,
      refreshCookieName: '__Host-dirego_refresh',
      refreshCookieSecure: true,
    });
  });

  it.each([
    ['JWT_ACCESS_TTL_SECONDS', '299'],
    ['JWT_ACCESS_TTL_SECONDS', '901'],
    ['SESSION_IDLE_TTL_SECONDS', '899'],
    ['SESSION_ABSOLUTE_TTL_SECONDS', '86399'],
    ['JWT_SIGNING_KEY_ID', 'invalid key id'],
  ])('rejects an invalid value for %s', (name, value) => {
    expect(() => parseTokenEnvironment(environment({ [name]: value }))).toThrow(
      name,
    );
  });

  it('requires the active key in the public verification map', () => {
    expect(() =>
      parseTokenEnvironment(
        environment({
          JWT_PUBLIC_KEYS_JSON: JSON.stringify({ 'old-key': publicKeyBase64 }),
        }),
      ),
    ).toThrow('active key is missing');
  });

  it('rejects insecure production cookies', () => {
    expect(() =>
      parseTokenEnvironment(
        environment({ NODE_ENV: 'production', REFRESH_COOKIE_SECURE: 'false' }),
      ),
    ).toThrow('REFRESH_COOKIE_SECURE');
  });

  it('rejects a session idle timeout equal to its absolute timeout', () => {
    expect(() =>
      parseTokenEnvironment(
        environment({
          SESSION_IDLE_TTL_SECONDS: '86400',
          SESSION_ABSOLUTE_TTL_SECONDS: '86400',
        }),
      ),
    ).toThrow('SESSION_IDLE_TTL_SECONDS');
  });

  it('does not expose rejected private key material in errors', () => {
    const secret = Buffer.from('not-a-private-key').toString('base64');
    try {
      parseTokenEnvironment(environment({ JWT_PRIVATE_KEY_B64: secret }));
    } catch (error) {
      expect(String(error)).not.toContain(secret);
      expect(String(error)).not.toContain('not-a-private-key');
    }
  });
});
