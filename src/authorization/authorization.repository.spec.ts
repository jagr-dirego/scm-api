import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { AuthorizationRepository } from './authorization.repository';

const identity = {
  userId: '10000000-0000-4000-8000-000000000001',
  organizationId: '10000000-0000-4000-8000-000000000002',
  sessionId: '10000000-0000-4000-8000-000000000003',
  tokenId: '10000000-0000-4000-8000-000000000004',
  issuedAt: 1,
  expiresAt: 2,
};

describe('AuthorizationRepository', () => {
  it('does not query PostgreSQL for an empty permission list', async () => {
    const pool = { query: vi.fn() };
    const repository = new AuthorizationRepository(pool as unknown as Pool);

    await expect(
      repository.resolvePermissions({ identity, permissionCodes: [] }),
    ).resolves.toEqual([]);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('uses token tenant and optional branch as parameterized values', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [{ permission_code: 'imports.upload', allowed: true }],
      }),
    };
    const repository = new AuthorizationRepository(pool as unknown as Pool);
    const branchId = '10000000-0000-4000-8000-000000000005';

    await expect(
      repository.resolvePermissions({
        identity,
        permissionCodes: ['imports.upload'],
        branchId,
      }),
    ).resolves.toEqual([{ permissionCode: 'imports.upload', allowed: true }]);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('permission_override.allowed'),
      [identity.userId, identity.organizationId, ['imports.upload'], branchId],
    );
  });
});
