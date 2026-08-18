import argon2 from 'argon2';
import { describe, expect, it } from 'vitest';
import type { PasswordHashOptions } from './password.constants';
import { PasswordService } from './password.service';

const options: PasswordHashOptions = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
};

describe('PasswordService', () => {
  it('creates an Argon2id hash with the configured parameters', async () => {
    const service = new PasswordService(options);
    const passwordHash = await service.hash('valid-test-password');

    expect(passwordHash).toMatch(/^\$argon2id\$v=19\$/);
    expect(passwordHash).toContain('m=19456');
    expect(passwordHash).toContain('t=2');
    expect(passwordHash).toContain('p=1');
    await expect(
      service.verify(passwordHash, 'valid-test-password'),
    ).resolves.toBe(true);
  });

  it('rejects an incorrect password without throwing', async () => {
    const service = new PasswordService(options);
    const passwordHash = await service.hash('valid-test-password');

    await expect(
      service.verify(passwordHash, 'incorrect-password'),
    ).resolves.toBe(false);
    await expect(service.verify('malformed-hash', 'password')).resolves.toBe(
      false,
    );
  });

  it('detects hashes that require stronger costs', async () => {
    const weakerHash = await argon2.hash('valid-test-password', {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
      hashLength: 32,
    });
    const service = new PasswordService({ ...options, timeCost: 3 });

    expect(service.needsRehash(weakerHash)).toBe(true);
  });

  it('detects an unexpected algorithm or hash length', async () => {
    const argon2iHash = await argon2.hash('valid-test-password', {
      ...options,
      type: argon2.argon2i,
    });
    const shortHash = await argon2.hash('valid-test-password', {
      ...options,
      type: argon2.argon2id,
      hashLength: 16,
    });
    const service = new PasswordService(options);

    expect(service.needsRehash(argon2iHash)).toBe(true);
    expect(service.needsRehash(shortHash)).toBe(true);
    expect(service.needsRehash('malformed-hash')).toBe(true);
  });

  it('accepts a current hash without rehashing', async () => {
    const service = new PasswordService(options);
    const passwordHash = await service.hash('valid-test-password');

    expect(service.needsRehash(passwordHash)).toBe(false);
  });

  it('performs dummy verification without exposing its result', async () => {
    const service = new PasswordService(options);

    await expect(
      service.verifyDummy('unknown-user-password'),
    ).resolves.toBeUndefined();
  });
});
