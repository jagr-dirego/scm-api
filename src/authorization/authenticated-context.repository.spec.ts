import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { AuthenticatedContextRepository } from './authenticated-context.repository';

const identity = {
  userId: '10000000-0000-4000-8000-000000000001',
  organizationId: '10000000-0000-4000-8000-000000000002',
  sessionId: '10000000-0000-4000-8000-000000000003',
  tokenId: '10000000-0000-4000-8000-000000000004',
  issuedAt: 1,
  expiresAt: 2,
};

describe('AuthenticatedContextRepository', () => {
  it('returns null when the authenticated tenant context is no longer active', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const repository = new AuthenticatedContextRepository(
      pool as unknown as Pool,
    );

    await expect(repository.find(identity)).resolves.toBeNull();
  });

  it('maps principal, default branch, session and sorted capabilities', async () => {
    const idleExpiresAt = new Date('2026-08-25T01:00:00.000Z');
    const absoluteExpiresAt = new Date('2026-09-24T01:00:00.000Z');
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            user_id: identity.userId,
            email: 'operator@dirego.test',
            display_name: 'SCM Operator',
            organization_id: identity.organizationId,
            organization_code: 'DIREGO',
            organization_name: 'DIREGO',
            membership_id: '10000000-0000-4000-8000-000000000005',
            default_branch_id: '10000000-0000-4000-8000-000000000006',
            default_branch_code: 'TAMPICO',
            default_branch_name: 'Tampico CEDI',
            session_id: identity.sessionId,
            idle_expires_at: idleExpiresAt,
            absolute_expires_at: absoluteExpiresAt,
            capabilities: ['imports.read', 'imports.upload'],
          },
        ],
      }),
    };
    const repository = new AuthenticatedContextRepository(
      pool as unknown as Pool,
    );

    await expect(repository.find(identity)).resolves.toEqual({
      user: {
        id: identity.userId,
        email: 'operator@dirego.test',
        displayName: 'SCM Operator',
      },
      organization: {
        id: identity.organizationId,
        code: 'DIREGO',
        name: 'DIREGO',
      },
      membership: {
        id: '10000000-0000-4000-8000-000000000005',
        defaultBranch: {
          id: '10000000-0000-4000-8000-000000000006',
          code: 'TAMPICO',
          name: 'Tampico CEDI',
        },
      },
      session: {
        id: identity.sessionId,
        idleExpiresAt: idleExpiresAt.toISOString(),
        absoluteExpiresAt: absoluteExpiresAt.toISOString(),
      },
      capabilities: ['imports.read', 'imports.upload'],
    });
    expect(pool.query).toHaveBeenCalledWith(expect.any(String), [
      identity.sessionId,
      identity.userId,
      identity.organizationId,
    ]);
  });

  it('binds memberships, branches, assignments and overrides to token tenant', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const repository = new AuthenticatedContextRepository(
      pool as unknown as Pool,
    );

    await repository.find(identity);

    const sql = pool.query.mock.calls[0]?.[0] as string;
    expect(sql).toContain('m.organization_id = o.id');
    expect(sql).toContain('branch.organization_id = o.id');
    expect(sql).toContain(
      'assignment.organization_id = identity.organization_id',
    );
    expect(sql).toContain(
      'user_override.organization_id = identity.organization_id',
    );
    expect(sql).toContain(
      'assigned_branch.organization_id = identity.organization_id',
    );
    expect(sql).toContain("permission.code NOT LIKE 'imports.type.%'");
    expect(sql).toContain("permission.code NOT LIKE 'imports.branch.%'");
  });
});
