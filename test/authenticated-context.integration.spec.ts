import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthenticatedContextRepository } from '../src/authorization/authenticated-context.repository';
import { AuthenticatedContextService } from '../src/authorization/authenticated-context.service';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'TEST_DATABASE_URL es obligatoria para el contexto autenticado',
  );
}

const pool = new pg.Pool({ connectionString: databaseUrl });
const service = new AuthenticatedContextService(
  new AuthenticatedContextRepository(pool),
);
const prefix = 'HU46_CONTEXT_TEST_';

const cleanup = async (): Promise<void> => {
  await pool.query('BEGIN');
  try {
    await pool.query(
      `DELETE FROM user_permission_overrides WHERE user_id IN (
         SELECT id FROM users WHERE email LIKE '%@hu46-context.test'
       )`,
    );
    await pool.query(
      `DELETE FROM user_role_assignments WHERE user_id IN (
         SELECT id FROM users WHERE email LIKE '%@hu46-context.test'
       )`,
    );
    await pool.query(
      `DELETE FROM role_permissions WHERE role_id IN (
         SELECT id FROM roles WHERE code LIKE $1
       )`,
      [`${prefix}%`],
    );
    await pool.query('DELETE FROM roles WHERE code LIKE $1', [`${prefix}%`]);
    await pool.query(
      `DELETE FROM sessions WHERE user_id IN (
         SELECT id FROM users WHERE email LIKE '%@hu46-context.test'
       )`,
    );
    await pool.query(
      `DELETE FROM user_memberships WHERE user_id IN (
         SELECT id FROM users WHERE email LIKE '%@hu46-context.test'
       )`,
    );
    await pool.query(
      "DELETE FROM users WHERE email LIKE '%@hu46-context.test'",
    );
    await pool.query(
      `DELETE FROM branches WHERE organization_id IN (
         SELECT id FROM organizations WHERE code LIKE $1
       )`,
      [`${prefix}%`],
    );
    await pool.query('DELETE FROM organizations WHERE code LIKE $1', [
      `${prefix}%`,
    ]);
    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
};

interface TenantFixture {
  organizationId: string;
  branchId: string;
  membershipId: string;
  sessionId: string;
}

const createTenant = async (
  userId: string,
  suffix: string,
): Promise<TenantFixture> => {
  const organization = await pool.query<{ id: string }>(
    `INSERT INTO organizations (code, name, slug)
     VALUES ($1, $2, $3) RETURNING id`,
    [`${prefix}${suffix}`, `Context ${suffix}`, `hu46-context-${suffix}`],
  );
  const organizationId = organization.rows[0].id;
  const branch = await pool.query<{ id: string }>(
    `INSERT INTO branches (organization_id, code, name, branch_type)
     VALUES ($1, $2, $3, 'CEDI') RETURNING id`,
    [organizationId, `${prefix}${suffix}`, `Branch ${suffix}`],
  );
  const branchId = branch.rows[0].id;
  const membership = await pool.query<{ id: string }>(
    `INSERT INTO user_memberships
       (organization_id, user_id, default_branch_id)
     VALUES ($1, $2, $3) RETURNING id`,
    [organizationId, userId, branchId],
  );
  const session = await pool.query<{ id: string }>(
    `INSERT INTO sessions
       (user_id, organization_id, idle_expires_at, absolute_expires_at)
     VALUES ($1, $2, now() + interval '8 hours', now() + interval '30 days')
     RETURNING id`,
    [userId, organizationId],
  );

  return {
    organizationId,
    branchId,
    membershipId: membership.rows[0].id,
    sessionId: session.rows[0].id,
  };
};

const assignPermission = async (
  userId: string,
  tenant: TenantFixture,
  suffix: string,
  permissionCode: string,
  scope: 'organization' | 'branch' = 'organization',
): Promise<void> => {
  const permission = await pool.query<{ id: string }>(
    `SELECT id FROM permissions WHERE code = $1`,
    [permissionCode],
  );
  const permissionId = permission.rows[0]?.id;
  if (!permissionId) throw new Error(`Seed ${permissionCode} no encontrado`);

  const role = await pool.query<{ id: string }>(
    `INSERT INTO roles (organization_id, code, name)
     VALUES ($1, $2, $3) RETURNING id`,
    [tenant.organizationId, `${prefix}${suffix}`, `Role ${suffix}`],
  );
  await pool.query(
    `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)`,
    [role.rows[0].id, permissionId],
  );
  await pool.query(
    `INSERT INTO user_role_assignments
       (user_id, organization_id, role_id, branch_id, scope)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      userId,
      tenant.organizationId,
      role.rows[0].id,
      scope === 'branch' ? tenant.branchId : null,
      scope,
    ],
  );
};

describe.sequential(
  'AuthenticatedContextService PostgreSQL integration',
  () => {
    beforeEach(cleanup);
    afterAll(async () => {
      await cleanup();
      await pool.end();
    });

    it('isolates identity, branch and capabilities by token organization', async () => {
      const user = await pool.query<{ id: string }>(
        `INSERT INTO users (email, display_name, password_hash)
       VALUES ('operator@hu46-context.test', 'Context Operator', 'not-used')
       RETURNING id`,
      );
      const userId = user.rows[0].id;
      const tenantA = await createTenant(userId, 'TENANT_A');
      const tenantB = await createTenant(userId, 'TENANT_B');
      await assignPermission(userId, tenantA, 'TENANT_A', 'imports.view');
      await assignPermission(
        userId,
        tenantA,
        'TENANT_A_INTERNAL',
        'imports.type.stock',
      );
      await assignPermission(
        userId,
        tenantB,
        'TENANT_B',
        'users.view',
        'branch',
      );

      const contextA = await service.resolve({
        userId,
        organizationId: tenantA.organizationId,
        sessionId: tenantA.sessionId,
        tokenId: '10000000-0000-4000-8000-000000000001',
        issuedAt: 1,
        expiresAt: 2,
      });
      const contextB = await service.resolve({
        userId,
        organizationId: tenantB.organizationId,
        sessionId: tenantB.sessionId,
        tokenId: '10000000-0000-4000-8000-000000000002',
        issuedAt: 1,
        expiresAt: 2,
      });

      expect(contextA).toMatchObject({
        organization: { id: tenantA.organizationId },
        membership: {
          id: tenantA.membershipId,
          defaultBranch: { id: tenantA.branchId },
        },
        capabilities: ['imports.view'],
      });
      expect(contextB).toMatchObject({
        organization: { id: tenantB.organizationId },
        membership: {
          id: tenantB.membershipId,
          defaultBranch: { id: tenantB.branchId },
        },
        capabilities: ['users.view'],
      });
    });

    it('returns null when session and token tenant do not match', async () => {
      const user = await pool.query<{ id: string }>(
        `INSERT INTO users (email, display_name, password_hash)
       VALUES ('mismatch@hu46-context.test', 'Context Mismatch', 'not-used')
       RETURNING id`,
      );
      const userId = user.rows[0].id;
      const tenantA = await createTenant(userId, 'MISMATCH_A');
      const tenantB = await createTenant(userId, 'MISMATCH_B');

      await expect(
        service.resolve({
          userId,
          organizationId: tenantB.organizationId,
          sessionId: tenantA.sessionId,
          tokenId: '10000000-0000-4000-8000-000000000003',
          issuedAt: 1,
          expiresAt: 2,
        }),
      ).resolves.toBeNull();
    });
  },
);
