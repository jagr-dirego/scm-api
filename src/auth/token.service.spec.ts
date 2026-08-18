import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { SignJWT, importPKCS8 } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { TokenVerificationError } from './errors/token-verification.error';
import type { TokenOptions } from './token.constants';
import { TokenService } from './token.service';

let privateKeyPem: string;
let publicKeyPem: string;
let oldPrivateKeyPem: string;
let oldPublicKeyPem: string;

beforeAll(() => {
  const keys = generateKeyPairSync('rsa', {
    modulusLength: 3072,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  privateKeyPem = keys.privateKey;
  publicKeyPem = keys.publicKey;
  const oldKeys = generateKeyPairSync('rsa', {
    modulusLength: 3072,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  oldPrivateKeyPem = oldKeys.privateKey;
  oldPublicKeyPem = oldKeys.publicKey;
});

const createOptions = (
  overrides: Partial<TokenOptions> = {},
): TokenOptions => ({
  issuer: 'https://api.dirego.test',
  audience: 'dirego-scm',
  accessTtlSeconds: 600,
  signingKeyId: 'test-key-1',
  privateKeyPem,
  publicKeysPem: { 'test-key-1': publicKeyPem },
  sessionIdleTtlSeconds: 28_800,
  sessionAbsoluteTtlSeconds: 2_592_000,
  refreshCookieName: '__Host-dirego_refresh',
  refreshCookieSecure: true,
  ...overrides,
});

const input = () => ({
  userId: randomUUID(),
  sessionId: randomUUID(),
  organizationId: randomUUID(),
});

describe('TokenService', () => {
  it('signs and verifies the approved minimal RS256 claims', async () => {
    const service = new TokenService(createOptions());
    const claims = input();

    const token = await service.signAccessToken(claims);

    await expect(service.verifyAccessToken(token)).resolves.toMatchObject({
      userId: claims.userId,
      sessionId: claims.sessionId,
      organizationId: claims.organizationId,
    });
  });

  it('passes the signing and verification startup probe', async () => {
    await expect(
      new TokenService(createOptions()).onModuleInit(),
    ).resolves.toBeUndefined();
  });

  it('rejects a token signed for another audience with a generic error', async () => {
    const signer = new TokenService(
      createOptions({ audience: 'another-audience' }),
    );
    const verifier = new TokenService(createOptions());

    await expect(
      verifier.verifyAccessToken(await signer.signAccessToken(input())),
    ).rejects.toBeInstanceOf(TokenVerificationError);
  });

  it('rejects an expired token with a generic error', async () => {
    const service = new TokenService(createOptions({ accessTtlSeconds: -1 }));

    await expect(
      service.verifyAccessToken(await service.signAccessToken(input())),
    ).rejects.toBeInstanceOf(TokenVerificationError);
  });

  it('rejects an unknown kid without exposing jose details', async () => {
    const key = await importPKCS8(privateKeyPem, 'RS256');
    const claims = input();
    const token = await new SignJWT({
      sid: claims.sessionId,
      oid: claims.organizationId,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'unknown-key' })
      .setIssuer('https://api.dirego.test')
      .setAudience('dirego-scm')
      .setSubject(claims.userId)
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(key);

    await expect(
      new TokenService(createOptions()).verifyAccessToken(token),
    ).rejects.toMatchObject({
      code: 'AUTH_INVALID_ACCESS_TOKEN',
      message: 'Access token no valido',
    });
  });

  it('rejects an unexpected signing algorithm', async () => {
    const claims = input();
    const token = await new SignJWT({
      sid: claims.sessionId,
      oid: claims.organizationId,
    })
      .setProtectedHeader({ alg: 'HS256', kid: 'test-key-1' })
      .setIssuer('https://api.dirego.test')
      .setAudience('dirego-scm')
      .setSubject(claims.userId)
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(new TextEncoder().encode('not-an-approved-signing-key'));

    await expect(
      new TokenService(createOptions()).verifyAccessToken(token),
    ).rejects.toBeInstanceOf(TokenVerificationError);
  });

  it('verifies tokens from a previous public key during rotation', async () => {
    const oldSigner = new TokenService(
      createOptions({
        signingKeyId: 'old-key',
        privateKeyPem: oldPrivateKeyPem,
        publicKeysPem: { 'old-key': oldPublicKeyPem },
      }),
    );
    const verifier = new TokenService(
      createOptions({
        publicKeysPem: {
          'test-key-1': publicKeyPem,
          'old-key': oldPublicKeyPem,
        },
      }),
    );

    const claims = input();
    await expect(
      verifier.verifyAccessToken(await oldSigner.signAccessToken(claims)),
    ).resolves.toMatchObject({ sessionId: claims.sessionId });
  });

  it('generates random 256-bit refresh tokens and deterministic SHA-256 hashes', () => {
    const service = new TokenService(createOptions());
    const first = service.generateRefreshToken();
    const second = service.generateRefreshToken();

    expect(Buffer.from(first, 'base64url')).toHaveLength(32);
    expect(first).not.toBe(second);
    expect(service.hashRefreshToken(first)).toHaveLength(43);
    expect(service.hashRefreshToken(first)).toBe(
      service.hashRefreshToken(first),
    );
    expect(service.hashRefreshToken(first)).not.toBe(
      service.hashRefreshToken(second),
    );
  });

  it('rejects malformed identifiers before signing', async () => {
    await expect(
      new TokenService(createOptions()).signAccessToken({
        userId: 'not-a-uuid',
        sessionId: randomUUID(),
        organizationId: randomUUID(),
      }),
    ).rejects.toBeDefined();
  });
});
