import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedIdentity } from './auth.repository';
import {
  RefreshTokenError,
  SessionOperationError,
} from './errors/session.error';
import type { SessionRepository } from './session.repository';
import { SessionService } from './session.service';
import type { TokenOptions } from './token.constants';
import type { TokenService } from './token.service';

const now = new Date('2026-08-18T12:00:00.000Z');
const identity: AuthenticatedIdentity = {
  userId: '10000000-0000-4000-8000-000000000001',
  organizationId: '10000000-0000-4000-8000-000000000002',
  membershipId: '10000000-0000-4000-8000-000000000003',
  email: 'admin@dirego.test',
  displayName: 'Administrador',
};
const options = {
  accessTtlSeconds: 600,
  sessionIdleTtlSeconds: 28_800,
  sessionAbsoluteTtlSeconds: 2_592_000,
} as TokenOptions;
const context = { ipAddress: '127.0.0.1', userAgent: 'vitest' };

const createDependencies = () => {
  const repository = {
    create: vi.fn().mockResolvedValue({
      sessionId: '10000000-0000-4000-8000-000000000004',
      idleExpiresAt: new Date(now.getTime() + 28_800_000),
      absoluteExpiresAt: new Date(now.getTime() + 2_592_000_000),
    }),
    rotate: vi.fn().mockResolvedValue({
      status: 'rotated',
      sessionId: '10000000-0000-4000-8000-000000000004',
      userId: identity.userId,
      organizationId: identity.organizationId,
      idleExpiresAt: new Date(now.getTime() + 28_800_000),
      absoluteExpiresAt: new Date(now.getTime() + 2_592_000_000),
    }),
    revokeAfterTokenFailure: vi.fn().mockResolvedValue(undefined),
    revokeByRefreshToken: vi.fn().mockResolvedValue(true),
    listActive: vi.fn().mockResolvedValue([]),
    revokeOwned: vi.fn().mockResolvedValue(undefined),
    revokeAllOwned: vi.fn().mockResolvedValue(undefined),
  };
  const tokenService = {
    generateRefreshToken: vi
      .fn()
      .mockReturnValueOnce('a'.repeat(43))
      .mockReturnValueOnce('b'.repeat(43)),
    hashRefreshToken: vi.fn((token: string) => `hash:${token}`),
    signAccessToken: vi.fn().mockResolvedValue('signed-access-token'),
  };
  return {
    repository,
    tokenService,
    service: new SessionService(
      repository as unknown as SessionRepository,
      tokenService as unknown as TokenService,
      options,
    ),
  };
};

describe('SessionService', () => {
  beforeEach(() => vi.useFakeTimers({ now }));
  afterEach(() => vi.useRealTimers());

  it('creates a session with approved idle and absolute expirations', async () => {
    const { service, repository } = createDependencies();

    const result = await service.createSession(
      identity,
      context,
      'Device'.repeat(50),
    );

    expect(result).toMatchObject({
      accessToken: 'signed-access-token',
      refreshToken: 'a'.repeat(43),
      accessTokenExpiresIn: 600,
    });
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        identity,
        refreshTokenHash: `hash:${'a'.repeat(43)}`,
        issuedAt: now,
        idleExpiresAt: new Date(now.getTime() + 28_800_000),
        absoluteExpiresAt: new Date(now.getTime() + 2_592_000_000),
        deviceName: 'Device'.repeat(50).slice(0, 200),
        context,
      }),
    );
  });

  it('revokes a committed session when access token signing fails', async () => {
    const { service, repository, tokenService } = createDependencies();
    tokenService.signAccessToken.mockRejectedValue(new Error('private detail'));

    await expect(
      service.createSession(identity, context),
    ).rejects.toBeInstanceOf(SessionOperationError);
    expect(repository.revokeAfterTokenFailure).toHaveBeenCalledWith(
      '10000000-0000-4000-8000-000000000004',
    );
  });

  it('rejects malformed refresh tokens before querying PostgreSQL', async () => {
    const { service, repository } = createDependencies();

    await expect(
      service.rotateSession('invalid', context),
    ).rejects.toBeInstanceOf(RefreshTokenError);
    expect(repository.rotate).not.toHaveBeenCalled();
  });

  it('rotates a valid refresh token and returns only the replacement secret', async () => {
    const { service, repository } = createDependencies();

    const result = await service.rotateSession('z'.repeat(43), context);

    expect(repository.rotate).toHaveBeenCalledWith(
      expect.objectContaining({
        presentedTokenHash: `hash:${'z'.repeat(43)}`,
        replacementTokenHash: `hash:${'a'.repeat(43)}`,
        rotatedAt: now,
        proposedIdleExpiresAt: new Date(now.getTime() + 28_800_000),
      }),
    );
    expect(result.refreshToken).toBe('a'.repeat(43));
    expect(result.refreshToken).not.toBe('z'.repeat(43));
  });

  it('returns the same generic error for invalid, reused or expired tokens', async () => {
    for (const status of ['invalid', 'reused', 'expired'] as const) {
      const { service, repository } = createDependencies();
      repository.rotate.mockResolvedValue({ status });

      await expect(
        service.rotateSession('z'.repeat(43), context),
      ).rejects.toMatchObject({
        code: 'AUTH_INVALID_REFRESH_TOKEN',
        message: 'Refresh token no valido',
      });
    }
  });

  it('revokes a session using only the refresh token hash', async () => {
    const { service, repository } = createDependencies();

    await service.revokeSession('z'.repeat(43), context);

    expect(repository.revokeByRefreshToken).toHaveBeenCalledWith(
      `hash:${'z'.repeat(43)}`,
      context,
    );
  });

  it('returns a generic error when logout cannot resolve the token', async () => {
    const { service, repository } = createDependencies();
    repository.revokeByRefreshToken.mockResolvedValue(false);

    await expect(
      service.revokeSession('z'.repeat(43), context),
    ).rejects.toBeInstanceOf(RefreshTokenError);
  });

  it('lists only repository sessions and marks the current one', async () => {
    const { service, repository } = createDependencies();
    repository.listActive.mockResolvedValue([
      {
        id: '10000000-0000-4000-8000-000000000004',
        deviceName: null,
      },
      {
        id: '10000000-0000-4000-8000-000000000005',
        deviceName: 'Firefox',
      },
    ]);

    const sessions = await service.listSessions({
      userId: identity.userId,
      organizationId: identity.organizationId,
      sessionId: '10000000-0000-4000-8000-000000000004',
      tokenId: '10000000-0000-4000-8000-000000000006',
      issuedAt: 1,
      expiresAt: 2,
    });

    expect(repository.listActive).toHaveBeenCalledWith(
      identity.userId,
      identity.organizationId,
    );
    expect(sessions.map(({ current }) => current)).toEqual([true, false]);
  });

  it('rejects a malformed target session before PostgreSQL', async () => {
    const { service, repository } = createDependencies();

    await expect(
      service.revokeOwnedSession(
        {
          userId: identity.userId,
          organizationId: identity.organizationId,
          sessionId: '10000000-0000-4000-8000-000000000004',
          tokenId: '10000000-0000-4000-8000-000000000006',
          issuedAt: 1,
          expiresAt: 2,
        },
        'not-a-uuid',
        context,
      ),
    ).rejects.toBeDefined();
    expect(repository.revokeOwned).not.toHaveBeenCalled();
  });

  it('delegates global revocation with the authenticated actor', async () => {
    const { service, repository } = createDependencies();
    const actor = {
      userId: identity.userId,
      organizationId: identity.organizationId,
      sessionId: '10000000-0000-4000-8000-000000000004',
      tokenId: '10000000-0000-4000-8000-000000000006',
      issuedAt: 1,
      expiresAt: 2,
    };

    await service.revokeAllSessions(actor, context);

    expect(repository.revokeAllOwned).toHaveBeenCalledWith(actor, context);
  });
});
