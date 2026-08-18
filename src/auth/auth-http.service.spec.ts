import { describe, expect, it, vi } from 'vitest';
import { AuthHttpService } from './auth-http.service';
import { CsrfValidationError } from './errors/csrf.error';
import { RefreshTokenError } from './errors/session.error';
import type { TokenOptions } from './token.constants';

const options = {
  refreshCookieName: '__Host-dirego_refresh',
  refreshCookieSecure: true,
} as TokenOptions;

describe('AuthHttpService', () => {
  const service = new AuthHttpService(
    { trustedOrigins: ['https://scm.dirego.test'] },
    options,
  );

  it('accepts only an exact trusted origin', () => {
    expect(() =>
      service.assertTrustedOrigin({
        headers: { origin: 'https://scm.dirego.test' },
      }),
    ).not.toThrow();
    expect(() =>
      service.assertTrustedOrigin({
        headers: { origin: 'https://scm.dirego.test.attacker.test' },
      }),
    ).toThrow(CsrfValidationError);
    expect(() => service.assertTrustedOrigin({ headers: {} })).toThrow(
      CsrfValidationError,
    );
  });

  it('reads only the configured cookie and validates its format', () => {
    const token = 'a'.repeat(43);
    expect(
      service.readRefreshToken({
        headers: {
          cookie: `other=value; __Host-dirego_refresh=${token}`,
        },
      }),
    ).toBe(token);
    expect(() =>
      service.readRefreshToken({
        headers: { cookie: '__Host-dirego_refresh=invalid' },
      }),
    ).toThrow(RefreshTokenError);
  });

  it('sets an HttpOnly, Lax, host-wide and secure cookie', () => {
    const header = vi.fn();
    service.setRefreshCookie(
      { header },
      'a'.repeat(43),
      new Date('2026-08-18T20:00:00Z'),
    );

    const serialized = String(header.mock.calls[0]?.[1]);
    expect(serialized).toContain('Path=/');
    expect(serialized).toContain('HttpOnly');
    expect(serialized).toContain('SameSite=Lax');
    expect(serialized).toContain('Secure');
    expect(serialized).not.toContain('Domain=');
  });

  it('clears the cookie with the same security attributes', () => {
    const header = vi.fn();
    service.clearRefreshCookie({ header });

    const serialized = String(header.mock.calls[0]?.[1]);
    expect(serialized).toContain('Max-Age=0');
    expect(serialized).toContain('HttpOnly');
    expect(serialized).toContain('Secure');
  });
});
