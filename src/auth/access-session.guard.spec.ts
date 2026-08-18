import {
  ServiceUnavailableException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AccessSessionGuard } from './access-session.guard';
import type { SessionRepository } from './session.repository';
import type { TokenService } from './token.service';

const claims = {
  userId: '10000000-0000-4000-8000-000000000001',
  organizationId: '10000000-0000-4000-8000-000000000002',
  sessionId: '10000000-0000-4000-8000-000000000003',
  tokenId: '10000000-0000-4000-8000-000000000004',
  issuedAt: 1,
  expiresAt: 2,
};

const createGuard = (authorization: string | undefined, active = true) => {
  const request = { headers: { authorization } };
  const tokenService = {
    verifyAccessToken: vi.fn().mockResolvedValue(claims),
  };
  const repository = {
    isAccessSessionActive: vi.fn().mockResolvedValue(active),
  };
  const executionContext = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as ExecutionContext;
  return {
    request,
    tokenService,
    repository,
    executionContext,
    guard: new AccessSessionGuard(
      tokenService as unknown as TokenService,
      repository as unknown as SessionRepository,
    ),
  };
};

describe('AccessSessionGuard', () => {
  it('verifies the Bearer token and attaches active claims', async () => {
    const fixture = createGuard('Bearer signed-token');

    await expect(
      fixture.guard.canActivate(fixture.executionContext),
    ).resolves.toBe(true);
    expect(fixture.tokenService.verifyAccessToken).toHaveBeenCalledWith(
      'signed-token',
    );
    expect(fixture.repository.isAccessSessionActive).toHaveBeenCalledWith(
      claims,
    );
    expect(fixture.request).toHaveProperty('auth', claims);
  });

  it.each([
    undefined,
    'signed-token',
    'Basic signed-token',
    'Bearer',
    'Bearer one two',
  ])('rejects malformed authorization value %s', async (authorization) => {
    const fixture = createGuard(authorization);

    await expect(
      fixture.guard.canActivate(fixture.executionContext),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(fixture.tokenService.verifyAccessToken).not.toHaveBeenCalled();
  });

  it('rejects a valid JWT whose PostgreSQL session is inactive', async () => {
    const fixture = createGuard('Bearer signed-token', false);

    await expect(
      fixture.guard.canActivate(fixture.executionContext),
    ).rejects.toMatchObject({
      response: {
        code: 'AUTH_INVALID_ACCESS_TOKEN',
        message: 'Access token no valido',
      },
    });
  });

  it('distinguishes a PostgreSQL outage from an invalid credential', async () => {
    const fixture = createGuard('Bearer signed-token');
    fixture.repository.isAccessSessionActive.mockRejectedValue(
      new Error('private database detail'),
    );

    await expect(
      fixture.guard.canActivate(fixture.executionContext),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
