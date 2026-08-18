import {
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import type { AuthorizationService } from './authorization.service';
import { PermissionsGuard } from './permissions.guard';
import type { PermissionRequirement } from './authorization.types';

const identity = {
  userId: '10000000-0000-4000-8000-000000000001',
  organizationId: '10000000-0000-4000-8000-000000000002',
  sessionId: '10000000-0000-4000-8000-000000000003',
  tokenId: '10000000-0000-4000-8000-000000000004',
  issuedAt: 1,
  expiresAt: 2,
};

const createGuard = (
  requirement: PermissionRequirement | undefined,
  allowed = true,
) => {
  const branchId = '10000000-0000-4000-8000-000000000005';
  const request = { auth: identity, params: { branchId } };
  const reflector = {
    getAllAndOverride: vi.fn().mockReturnValue(requirement),
  };
  const service = { isAllowed: vi.fn().mockResolvedValue(allowed) };
  const context = {
    getHandler: vi.fn(),
    getClass: vi.fn(),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return {
    context,
    reflector,
    request,
    service,
    guard: new PermissionsGuard(
      reflector as unknown as Reflector,
      service as unknown as AuthorizationService,
    ),
  };
};

describe('PermissionsGuard', () => {
  it('denies by default when no requirement is declared', async () => {
    const fixture = createGuard(undefined);

    await expect(
      fixture.guard.canActivate(fixture.context),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fixture.service.isAllowed).not.toHaveBeenCalled();
  });

  it('requires AccessSessionGuard to attach an identity first', async () => {
    const fixture = createGuard({ permissions: ['users.read'], mode: 'all' });
    delete (fixture.request as { auth?: typeof identity }).auth;

    await expect(
      fixture.guard.canActivate(fixture.context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('passes the token tenant and route branch to the service', async () => {
    const requirement = {
      permissions: ['imports.upload'],
      mode: 'all' as const,
      branchParam: 'branchId',
    };
    const fixture = createGuard(requirement);

    await expect(fixture.guard.canActivate(fixture.context)).resolves.toBe(
      true,
    );
    expect(fixture.service.isAllowed).toHaveBeenCalledWith(
      {
        identity,
        permissionCodes: requirement.permissions,
        branchId: '10000000-0000-4000-8000-000000000005',
      },
      requirement,
    );
  });

  it('denies when a required branch route parameter is absent', async () => {
    const fixture = createGuard({
      permissions: ['stock.read'],
      mode: 'all',
      branchParam: 'missing',
    });

    await expect(
      fixture.guard.canActivate(fixture.context),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies an invalid branch UUID without querying authorization', async () => {
    const fixture = createGuard({
      permissions: ['stock.read'],
      mode: 'all',
      branchParam: 'branchId',
    });
    fixture.request.params.branchId = 'not-a-uuid';

    await expect(
      fixture.guard.canActivate(fixture.context),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(fixture.service.isAllowed).not.toHaveBeenCalled();
  });

  it('returns a stable forbidden response for a valid denial', async () => {
    const fixture = createGuard(
      { permissions: ['users.write'], mode: 'all' },
      false,
    );

    await expect(
      fixture.guard.canActivate(fixture.context),
    ).rejects.toMatchObject({
      response: { code: 'AUTHORIZATION_DENIED' },
    });
  });

  it('distinguishes a repository outage from denied access', async () => {
    const fixture = createGuard({ permissions: ['users.read'], mode: 'all' });
    fixture.service.isAllowed.mockRejectedValue(new Error('private detail'));

    await expect(
      fixture.guard.canActivate(fixture.context),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
