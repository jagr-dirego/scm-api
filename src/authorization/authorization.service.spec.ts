import { describe, expect, it, vi } from 'vitest';
import type { VerifiedAccessToken } from '../auth/token.service';
import type { AuthorizationRepository } from './authorization.repository';
import { AuthorizationService } from './authorization.service';

const identity: VerifiedAccessToken = {
  userId: '10000000-0000-4000-8000-000000000001',
  organizationId: '10000000-0000-4000-8000-000000000002',
  sessionId: '10000000-0000-4000-8000-000000000003',
  tokenId: '10000000-0000-4000-8000-000000000004',
  issuedAt: 1,
  expiresAt: 2,
};

const createService = () => {
  const repository = { resolvePermissions: vi.fn() };
  return {
    repository,
    service: new AuthorizationService(
      repository as unknown as AuthorizationRepository,
    ),
  };
};

describe('AuthorizationService', () => {
  it('denies an empty permission requirement without querying PostgreSQL', async () => {
    const fixture = createService();

    await expect(
      fixture.service.isAllowed(
        { identity, permissionCodes: [] },
        { permissions: [], mode: 'all' },
      ),
    ).resolves.toBe(false);
    expect(fixture.repository.resolvePermissions).not.toHaveBeenCalled();
  });

  it('requires every permission in all mode', async () => {
    const fixture = createService();
    fixture.repository.resolvePermissions.mockResolvedValue([
      { permissionCode: 'users.read', allowed: true },
      { permissionCode: 'users.write', allowed: false },
    ]);

    await expect(
      fixture.service.isAllowed(
        {
          identity,
          permissionCodes: ['users.read', 'users.write'],
        },
        {
          permissions: ['users.read', 'users.write'],
          mode: 'all',
        },
      ),
    ).resolves.toBe(false);
  });

  it('accepts one effective permission in any mode', async () => {
    const fixture = createService();
    fixture.repository.resolvePermissions.mockResolvedValue([
      { permissionCode: 'users.read', allowed: true },
    ]);

    await expect(
      fixture.service.isAllowed(
        {
          identity,
          permissionCodes: ['users.read', 'users.write'],
        },
        {
          permissions: ['users.read', 'users.write'],
          mode: 'any',
        },
      ),
    ).resolves.toBe(true);
  });

  it('denies unknown or inactive permissions omitted by the repository', async () => {
    const fixture = createService();
    fixture.repository.resolvePermissions.mockResolvedValue([]);

    await expect(
      fixture.service.isAllowed(
        { identity, permissionCodes: ['unknown.permission'] },
        { permissions: ['unknown.permission'], mode: 'all' },
      ),
    ).resolves.toBe(false);
  });
});
