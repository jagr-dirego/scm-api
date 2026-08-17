import { describe, expect, it } from 'vitest';
import { parseEnvironment } from './environment.schema';

const requiredEnvironment = {
  DATABASE_URL: 'postgresql://scm_test:test@127.0.0.1:15433/scm_test',
};

describe('parseEnvironment', () => {
  it('uses the approved initial Argon2id and lockout defaults', () => {
    const environment = parseEnvironment(requiredEnvironment);

    expect(environment).toMatchObject({
      ARGON2_MEMORY_COST: 65_536,
      ARGON2_TIME_COST: 3,
      ARGON2_PARALLELISM: 1,
      ARGON2_HASH_LENGTH: 32,
      AUTH_MAX_FAILED_ATTEMPTS: 5,
      AUTH_LOCKOUT_MINUTES: 15,
    });
  });

  it.each([
    ['ARGON2_MEMORY_COST', '19455'],
    ['ARGON2_TIME_COST', '1'],
    ['ARGON2_PARALLELISM', '0'],
    ['ARGON2_HASH_LENGTH', '15'],
    ['AUTH_MAX_FAILED_ATTEMPTS', '2'],
    ['AUTH_LOCKOUT_MINUTES', '0'],
  ])('rejects an unsafe value for %s', (name, value) => {
    expect(() =>
      parseEnvironment({ ...requiredEnvironment, [name]: value }),
    ).toThrow(`Invalid application configuration: ${name}:`);
  });

  it('does not include a rejected database URL in the error', () => {
    const invalidUrl = 'secret-value-that-must-not-be-logged';

    expect(() => parseEnvironment({ DATABASE_URL: invalidUrl })).toThrow(
      'DATABASE_URL: Invalid url',
    );

    try {
      parseEnvironment({ DATABASE_URL: invalidUrl });
    } catch (error) {
      expect(String(error)).not.toContain(invalidUrl);
    }
  });
});
