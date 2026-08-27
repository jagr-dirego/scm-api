import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import type { AuthHttpService } from './auth-http.service';
import type { CookieReply } from './auth-http.service';
import { AuthController } from './auth.controller';
import type { AuthService } from './auth.service';
import {
  AuthenticationError,
  type AuthenticationFailureReason,
} from './errors/authentication.error';
import { CsrfValidationError } from './errors/csrf.error';
import { RefreshTokenError } from './errors/session.error';
import type { SessionService } from './session.service';

const request = {
  ip: '127.0.0.1',
  headers: {
    origin: 'http://localhost:5173',
    cookie: 'dirego_refresh=current',
    'user-agent': 'x'.repeat(2048),
  },
};
const reply = {} as CookieReply;
const identity = {
  userId: '10000000-0000-4000-8000-000000000001',
  organizationId: '10000000-0000-4000-8000-000000000002',
  membershipId: '10000000-0000-4000-8000-000000000003',
  email: 'admin@dirego.test',
  displayName: 'Administrador',
};
const tokens = {
  accessToken: 'access',
  accessTokenExpiresIn: 600,
  refreshToken: 'r'.repeat(43),
  sessionId: '10000000-0000-4000-8000-000000000004',
  idleExpiresAt: new Date('2026-08-18T20:00:00Z'),
  absoluteExpiresAt: new Date('2026-09-17T12:00:00Z'),
};

const createController = (
  login = vi.fn().mockResolvedValue(identity),
  sessionOverrides: Record<string, unknown> = {},
  httpOverrides: Record<string, unknown> = {},
) => {
  const session = {
    createSession: vi.fn().mockResolvedValue(tokens),
    rotateSession: vi.fn().mockResolvedValue(tokens),
    revokeSession: vi.fn().mockResolvedValue(undefined),
    listSessions: vi.fn().mockResolvedValue([]),
    revokeOwnedSession: vi.fn().mockResolvedValue(undefined),
    revokeAllSessions: vi.fn().mockResolvedValue(undefined),
    ...sessionOverrides,
  };
  const http = {
    assertTrustedOrigin: vi.fn(),
    readRefreshToken: vi.fn().mockReturnValue('c'.repeat(43)),
    setRefreshCookie: vi.fn(),
    clearRefreshCookie: vi.fn(),
    ...httpOverrides,
  };
  return {
    login,
    session,
    http,
    controller: new AuthController(
      { login } as unknown as AuthService,
      session as unknown as SessionService,
      http as unknown as AuthHttpService,
    ),
  };
};

describe('AuthController', () => {
  it('declares the login success response as HTTP 200', () => {
    const loginHandler = Object.getOwnPropertyDescriptor(
      AuthController.prototype,
      'login',
    )?.value as AuthController['login'];

    expect(Reflect.getMetadata(HTTP_CODE_METADATA, loginHandler)).toBe(200);
  });

  it.each<AuthenticationFailureReason>([
    'invalid_credentials',
    'account_inactive',
    'account_locked',
    'membership_inactive',
    'organization_required',
  ])('returns the same external response for %s', async (reason) => {
    const { controller } = createController(
      vi.fn().mockRejectedValue(new AuthenticationError(reason)),
    );

    const error = await controller
      .login(
        { email: 'admin@dirego.test', password: 'Password1!' },
        request,
        reply,
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).getResponse()).toEqual({
      statusCode: 401,
      code: 'AUTH_INVALID_CREDENTIALS',
      message: 'Credenciales o sesion no validas',
    });
  });

  it('creates a session, sets the cookie and never returns the refresh token', async () => {
    const { controller, login, session, http } = createController();

    const result = await controller.login(
      { email: 'admin@dirego.test', password: 'Password1!' },
      request,
      reply,
    );

    expect(login).toHaveBeenCalledWith(expect.anything(), {
      ipAddress: '127.0.0.1',
      userAgent: 'x'.repeat(1024),
    });
    expect(http.assertTrustedOrigin).toHaveBeenCalledWith(request);
    expect(session.createSession).toHaveBeenCalledWith(
      identity,
      expect.anything(),
    );
    expect(http.setRefreshCookie).toHaveBeenCalledWith(
      reply,
      tokens.refreshToken,
      tokens.idleExpiresAt,
    );
    expect(result).not.toHaveProperty('refreshToken');
    expect(JSON.stringify(result)).not.toContain(tokens.refreshToken);
  });

  it('rotates from the cookie after validating the request origin', async () => {
    const { controller, session, http } = createController();

    const result = await controller.refresh(request, reply);

    expect(http.assertTrustedOrigin).toHaveBeenCalledWith(request);
    expect(session.rotateSession).toHaveBeenCalledWith(
      'c'.repeat(43),
      expect.objectContaining({ ipAddress: '127.0.0.1' }),
    );
    expect(http.setRefreshCookie).toHaveBeenCalledWith(
      reply,
      tokens.refreshToken,
      tokens.idleExpiresAt,
    );
    expect(result).not.toHaveProperty('refreshToken');
  });

  it('clears the cookie and returns a generic error for invalid refresh', async () => {
    const { controller, http } = createController(vi.fn(), {
      rotateSession: vi.fn().mockRejectedValue(new RefreshTokenError()),
    });

    const error = await controller
      .refresh(request, reply)
      .catch((caught: unknown) => caught);

    expect(http.clearRefreshCookie).toHaveBeenCalledWith(reply);
    expect(error).toBeInstanceOf(UnauthorizedException);
  });

  it('rejects untrusted origins before reading the cookie', async () => {
    const { controller, http } = createController(
      vi.fn(),
      {},
      {
        assertTrustedOrigin: vi.fn().mockImplementation(() => {
          throw new CsrfValidationError();
        }),
      },
    );

    const error = await controller
      .refresh(request, reply)
      .catch((caught: unknown) => caught);

    expect(http.readRefreshToken).not.toHaveBeenCalled();
    expect(error).toBeInstanceOf(ForbiddenException);
  });

  it('makes logout externally idempotent and always clears the cookie', async () => {
    const { controller, session, http } = createController(vi.fn(), {
      revokeSession: vi.fn().mockRejectedValue(new RefreshTokenError()),
    });

    await expect(controller.logout(request, reply)).resolves.toBeUndefined();
    expect(session.revokeSession).toHaveBeenCalled();
    expect(http.clearRefreshCookie).toHaveBeenCalledWith(reply);
  });

  it('returns a controlled bad request without echoing invalid input', async () => {
    const { controller } = createController(
      vi.fn().mockRejectedValue(new ZodError([])),
    );

    const error = await controller
      .login({ email: 'invalid', password: 'secret' }, request, reply)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
  });

  it('lists sessions using only the actor attached by the guard', async () => {
    const { controller, session } = createController();
    const authenticatedRequest = {
      ...request,
      auth: {
        userId: identity.userId,
        organizationId: identity.organizationId,
        sessionId: tokens.sessionId,
        tokenId: '10000000-0000-4000-8000-000000000005',
        issuedAt: 1,
        expiresAt: 2,
      },
    };

    await expect(
      controller.listSessions(authenticatedRequest),
    ).resolves.toEqual({
      sessions: [],
    });
    expect(session.listSessions).toHaveBeenCalledWith(
      authenticatedRequest.auth,
    );
  });

  it('revokes an owned session without accepting identity from input', async () => {
    const { controller, session } = createController();
    const authenticatedRequest = {
      ...request,
      auth: {
        userId: identity.userId,
        organizationId: identity.organizationId,
        sessionId: tokens.sessionId,
        tokenId: '10000000-0000-4000-8000-000000000005',
        issuedAt: 1,
        expiresAt: 2,
      },
    };

    await controller.revokeSession(
      '10000000-0000-4000-8000-000000000006',
      authenticatedRequest,
    );

    expect(session.revokeOwnedSession).toHaveBeenCalledWith(
      authenticatedRequest.auth,
      '10000000-0000-4000-8000-000000000006',
      expect.objectContaining({ ipAddress: '127.0.0.1' }),
    );
  });

  it('revokes every owned session and clears the current cookie', async () => {
    const { controller, session, http } = createController();
    const authenticatedRequest = {
      ...request,
      auth: {
        userId: identity.userId,
        organizationId: identity.organizationId,
        sessionId: tokens.sessionId,
        tokenId: '10000000-0000-4000-8000-000000000005',
        issuedAt: 1,
        expiresAt: 2,
      },
    };

    await controller.logoutAll(authenticatedRequest, reply);

    expect(session.revokeAllSessions).toHaveBeenCalledWith(
      authenticatedRequest.auth,
      expect.objectContaining({ ipAddress: '127.0.0.1' }),
    );
    expect(http.clearRefreshCookie).toHaveBeenCalledWith(reply);
  });
});
