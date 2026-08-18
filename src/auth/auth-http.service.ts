import { Inject, Injectable } from '@nestjs/common';
import { AUTH_HTTP_OPTIONS, type AuthHttpOptions } from './auth.constants';
import { CsrfValidationError } from './errors/csrf.error';
import { RefreshTokenError } from './errors/session.error';
import { TOKEN_OPTIONS, type TokenOptions } from './token.constants';

interface CookieRequest {
  headers: Record<string, string | string[] | undefined>;
}

export interface CookieReply {
  header(name: string, value: string): unknown;
}

@Injectable()
export class AuthHttpService {
  constructor(
    @Inject(AUTH_HTTP_OPTIONS) private readonly httpOptions: AuthHttpOptions,
    @Inject(TOKEN_OPTIONS) private readonly tokenOptions: TokenOptions,
  ) {}

  assertTrustedOrigin(request: CookieRequest): void {
    const value = request.headers.origin;
    const origin = Array.isArray(value) ? value[0] : value;
    if (!origin || !this.httpOptions.trustedOrigins.includes(origin)) {
      throw new CsrfValidationError();
    }
  }

  readRefreshToken(request: CookieRequest): string {
    const value = request.headers.cookie;
    const cookieHeader = Array.isArray(value) ? value[0] : value;
    const encoded = cookieHeader
      ?.split(';')
      .map((part) => part.trim())
      .find((part) =>
        part.startsWith(`${this.tokenOptions.refreshCookieName}=`),
      )
      ?.slice(this.tokenOptions.refreshCookieName.length + 1);
    if (!encoded) throw new RefreshTokenError();

    try {
      const token = decodeURIComponent(encoded);
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('invalid');
      return token;
    } catch {
      throw new RefreshTokenError();
    }
  }

  setRefreshCookie(
    reply: CookieReply,
    refreshToken: string,
    expiresAt: Date,
  ): void {
    reply.header(
      'Set-Cookie',
      this.serializeCookie(encodeURIComponent(refreshToken), [
        `Expires=${expiresAt.toUTCString()}`,
      ]),
    );
  }

  clearRefreshCookie(reply: CookieReply): void {
    reply.header(
      'Set-Cookie',
      this.serializeCookie('', [
        'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
        'Max-Age=0',
      ]),
    );
  }

  private serializeCookie(value: string, expiration: string[]): string {
    return [
      `${this.tokenOptions.refreshCookieName}=${value}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      ...expiration,
      ...(this.tokenOptions.refreshCookieSecure ? ['Secure'] : []),
    ].join('; ');
  }
}
