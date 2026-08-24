import { describe, expect, it } from 'vitest';
import { assertSafeTestDatabaseUrl } from './test-database-safety';

describe('assertSafeTestDatabaseUrl', () => {
  it('accepts the isolated local test database', () => {
    const value = 'postgresql://scm_test:secret@127.0.0.1:15433/scm_test';

    expect(assertSafeTestDatabaseUrl(value)).toBe(value);
  });

  it.each([
    undefined,
    'postgresql://scm_app:secret@127.0.0.1:5432/scm_kardex',
    'postgresql://scm_test:secret@database.internal:5432/scm_test',
    'mysql://scm_test:secret@127.0.0.1:3306/scm_test',
  ])('rejects an unsafe destination', (value) => {
    expect(() => assertSafeTestDatabaseUrl(value)).toThrow();
  });
});
