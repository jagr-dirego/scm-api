import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthorizationRepository } from '../src/authorization/authorization.repository';
import { AuthorizationService } from '../src/authorization/authorization.service';
import { ImportAuthorizationRepository } from '../src/authorization/import-authorization.repository';
import { ImportAuthorizationService } from '../src/authorization/import-authorization.service';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error('TEST_DATABASE_URL es obligatoria para la integracion RBAC');
}

const pool = new pg.Pool({ connectionString: databaseUrl });
const service = new ImportAuthorizationService(
  new ImportAuthorizationRepository(pool),
);
const permissionService = new AuthorizationService(
  new AuthorizationRepository(pool),
);
const prefix = 'HU29_AUTHZ_TEST_';

interface Fixture {
  organizationId: string;
  userId: string;
  permissionId: string;
  documentTypeId: string;
  fileBranchId: string;
  input: Parameters<ImportAuthorizationService['authorize']>[0];
}

const cleanup = async (): Promise<void> => {
  await pool.query('BEGIN');
  try {
    await pool.query(
      `DELETE FROM user_permission_overrides WHERE user_id IN (
         SELECT id FROM users WHERE email LIKE '%@hu29-authz.test'
       )`,
    );
    await pool.query(
      `DELETE FROM user_import_type_overrides WHERE user_id IN (
         SELECT id FROM users WHERE email LIKE '%@hu29-authz.test'
       )`,
    );
    await pool.query(
      `DELETE FROM user_import_branch_overrides WHERE user_id IN (
         SELECT id FROM users WHERE email LIKE '%@hu29-authz.test'
       )`,
    );
    await pool.query(
      `DELETE FROM user_role_assignments WHERE user_id IN (
         SELECT id FROM users WHERE email LIKE '%@hu29-authz.test'
       )`,
    );
    await pool.query(
      `DELETE FROM role_permissions WHERE role_id IN (
         SELECT id FROM roles WHERE code LIKE $1
       )`,
      [`${prefix}%`],
    );
    await pool.query(
      `DELETE FROM role_import_type_permissions WHERE role_id IN (
         SELECT id FROM roles WHERE code LIKE $1
       )`,
      [`${prefix}%`],
    );
    await pool.query(
      `DELETE FROM role_import_branch_permissions WHERE role_id IN (
         SELECT id FROM roles WHERE code LIKE $1
       )`,
      [`${prefix}%`],
    );
    await pool.query('DELETE FROM roles WHERE code LIKE $1', [`${prefix}%`]);
    await pool.query(
      `DELETE FROM user_memberships WHERE user_id IN (
         SELECT id FROM users WHERE email LIKE '%@hu29-authz.test'
       )`,
    );
    await pool.query("DELETE FROM users WHERE email LIKE '%@hu29-authz.test'");
    await pool.query('DELETE FROM organizations WHERE code LIKE $1', [
      `${prefix}%`,
    ]);
    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
};

const createFixture = async (suffix: string): Promise<Fixture> => {
  const organization = await pool.query<{ id: string }>(
    `INSERT INTO organizations (code, name, slug)
     VALUES ($1, $2, $3) RETURNING id`,
    [`${prefix}${suffix}`, `Authorization ${suffix}`, `hu29-authz-${suffix}`],
  );
  const user = await pool.query<{ id: string }>(
    `INSERT INTO users (email, display_name, password_hash)
     VALUES ($1, $2, $3) RETURNING id`,
    [`${suffix}@hu29-authz.test`, `Authorization ${suffix}`, 'not-used'],
  );
  await pool.query(
    `INSERT INTO user_memberships (organization_id, user_id)
     VALUES ($1, $2)`,
    [organization.rows[0].id, user.rows[0].id],
  );
  const references = await pool.query<{
    permission_id: string;
    document_type_id: string;
    file_branch_id: string;
  }>(
    `SELECT permission.id AS permission_id,
       document_type.id AS document_type_id,
       file_branch.id AS file_branch_id
     FROM permissions AS permission
     CROSS JOIN cat_document_types AS document_type
     CROSS JOIN cat_file_branches AS file_branch
     WHERE permission.code = 'imports.upload'
       AND document_type.code = 'stock'
       AND file_branch.code = 'general'`,
  );
  const reference = references.rows[0];
  if (!reference) throw new Error('Seeds RBAC requeridos no encontrados');

  return {
    organizationId: organization.rows[0].id,
    userId: user.rows[0].id,
    permissionId: reference.permission_id,
    documentTypeId: reference.document_type_id,
    fileBranchId: reference.file_branch_id,
    input: {
      identity: {
        userId: user.rows[0].id,
        organizationId: organization.rows[0].id,
        sessionId: '10000000-0000-4000-8000-000000000001',
        tokenId: '10000000-0000-4000-8000-000000000002',
        issuedAt: 1,
        expiresAt: 2,
      },
      actionPermissionCode: 'imports.upload',
      documentTypeCode: 'stock',
      fileBranchCode: 'general',
    },
  };
};

const assignRole = async (
  fixture: Fixture,
  suffix: string,
  grants: { action: boolean; type: boolean; branch: boolean },
): Promise<string> => {
  const role = await pool.query<{ id: string }>(
    `INSERT INTO roles (organization_id, code, name)
     VALUES ($1, $2, $3) RETURNING id`,
    [fixture.organizationId, `${prefix}${suffix}`, `Role ${suffix}`],
  );
  const roleId = role.rows[0].id;
  await pool.query(
    `INSERT INTO user_role_assignments
       (user_id, organization_id, role_id, scope)
     VALUES ($1, $2, $3, 'organization')`,
    [fixture.userId, fixture.organizationId, roleId],
  );
  if (grants.action) {
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       VALUES ($1, $2)`,
      [roleId, fixture.permissionId],
    );
  }
  if (grants.type) {
    await pool.query(
      `INSERT INTO role_import_type_permissions
         (role_id, document_type_id, allowed)
       VALUES ($1, $2, true)`,
      [roleId, fixture.documentTypeId],
    );
  }
  if (grants.branch) {
    await pool.query(
      `INSERT INTO role_import_branch_permissions
         (role_id, file_branch_id, allowed)
       VALUES ($1, $2, true)`,
      [roleId, fixture.fileBranchId],
    );
  }
  return roleId;
};

describe.sequential('ImportAuthorizationService PostgreSQL integration', () => {
  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  it('authorizes action, type and file branch granted by the same role', async () => {
    const fixture = await createFixture('SAME_ROLE');
    await assignRole(fixture, 'SAME_ROLE', {
      action: true,
      type: true,
      branch: true,
    });

    await expect(service.authorize(fixture.input)).resolves.toMatchObject({
      allowed: true,
      profile: { code: 'stock_general' },
    });
    await expect(
      permissionService.isAllowed(
        {
          identity: fixture.input.identity,
          permissionCodes: ['imports.upload'],
        },
        { permissions: ['imports.upload'], mode: 'all' },
      ),
    ).resolves.toBe(true);
  });

  it('rejects dimensions composed from different roles', async () => {
    const fixture = await createFixture('SPLIT');
    await assignRole(fixture, 'SPLIT_A', {
      action: true,
      type: true,
      branch: false,
    });
    await assignRole(fixture, 'SPLIT_B', {
      action: false,
      type: false,
      branch: true,
    });

    await expect(service.authorize(fixture.input)).resolves.toMatchObject({
      allowed: false,
      profile: { code: 'stock_general' },
    });
  });

  it('applies an explicit deny override before a complete role grant', async () => {
    const fixture = await createFixture('DENY');
    await assignRole(fixture, 'DENY', {
      action: true,
      type: true,
      branch: true,
    });
    await pool.query(
      `INSERT INTO user_permission_overrides
         (user_id, organization_id, permission_id, allowed, reason,
          assigned_by_user_id)
       VALUES ($1, $2, $3, false, 'integration denial', $1)`,
      [fixture.userId, fixture.organizationId, fixture.permissionId],
    );

    await expect(service.authorize(fixture.input)).resolves.toMatchObject({
      allowed: false,
    });
    await expect(
      permissionService.isAllowed(
        {
          identity: fixture.input.identity,
          permissionCodes: ['imports.upload'],
        },
        { permissions: ['imports.upload'], mode: 'all' },
      ),
    ).resolves.toBe(false);
  });

  it('uses a positive override only for the missing dimension', async () => {
    const fixture = await createFixture('ALLOW');
    await assignRole(fixture, 'ALLOW', {
      action: true,
      type: false,
      branch: true,
    });
    await pool.query(
      `INSERT INTO user_import_type_overrides
         (user_id, organization_id, document_type_id, allowed, reason,
          assigned_by_user_id)
       VALUES ($1, $2, $3, true, 'integration allowance', $1)`,
      [fixture.userId, fixture.organizationId, fixture.documentTypeId],
    );

    await expect(service.authorize(fixture.input)).resolves.toMatchObject({
      allowed: true,
      profile: { code: 'stock_general' },
    });
  });
});
