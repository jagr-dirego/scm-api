import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BootstrapAdminRepository } from '../src/bootstrap-admin/bootstrap-admin.repository';
import { BootstrapAlreadyCompletedError } from '../src/bootstrap-admin/errors/bootstrap.errors';
import type { ValidatedBootstrapInput } from '../src/bootstrap-admin/schemas/bootstrap-input.schema';

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    'TEST_DATABASE_URL es obligatoria para la integracion de bootstrap',
  );
}

const pool = new pg.Pool({ connectionString: databaseUrl });
const repository = new BootstrapAdminRepository(pool);

interface CountRow {
  count: number;
}

const createInput = (suffix: string): ValidatedBootstrapInput => ({
  organizationCode: `HU27_TEST_${suffix}`,
  organizationName: `HU27 Test ${suffix}`,
  organizationSlug: `hu27-test-${suffix.toLowerCase()}`,
  email: `${suffix.toLowerCase()}@hu27.test`,
  displayName: `Administrador ${suffix}`,
  password: 'IntegrationOnly1!',
});

const cleanup = async (): Promise<void> => {
  await pool.query('BEGIN');
  try {
    await pool.query(
      `DELETE FROM audit_logs
       WHERE organization_id IN (
         SELECT id FROM organizations WHERE code LIKE 'HU27_TEST_%'
       )`,
    );
    await pool.query(
      `DELETE FROM user_role_assignments
       WHERE organization_id IN (
         SELECT id FROM organizations WHERE code LIKE 'HU27_TEST_%'
       )`,
    );
    await pool.query(
      `DELETE FROM user_memberships
       WHERE organization_id IN (
         SELECT id FROM organizations WHERE code LIKE 'HU27_TEST_%'
       )`,
    );
    await pool.query("DELETE FROM users WHERE email LIKE '%@hu27.test'");
    await pool.query("DELETE FROM organizations WHERE code LIKE 'HU27_TEST_%'");
    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
};

describe.sequential('BootstrapAdminRepository PostgreSQL integration', () => {
  beforeAll(async () => {
    const prerequisite = await pool.query<CountRow>(
      `SELECT count(*)::integer AS count FROM roles
       WHERE code = 'SuperAdmin' AND organization_id IS NULL
         AND is_system = true AND status = 'active'`,
    );
    expect(prerequisite.rows[0]?.count).toBe(1);
  });

  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  it('creates exactly one organization, user, membership, assignment and audit event', async () => {
    const result = await repository.execute(
      createInput('SUCCESS'),
      '$argon2id$integration-hash',
    );
    const counts = await pool.query(
      `SELECT
         (SELECT count(*)::integer FROM organizations WHERE id = $1) AS organizations,
         (SELECT count(*)::integer FROM users WHERE id = $2) AS users,
         (SELECT count(*)::integer FROM user_memberships WHERE id = $3) AS memberships,
         (SELECT count(*)::integer FROM user_role_assignments WHERE id = $4) AS assignments,
         (SELECT count(*)::integer FROM audit_logs
          WHERE organization_id = $1 AND action = 'system.bootstrap.completed') AS audits`,
      [
        result.organizationId,
        result.userId,
        result.membershipId,
        result.roleAssignmentId,
      ],
    );

    expect(counts.rows[0]).toEqual({
      organizations: 1,
      users: 1,
      memberships: 1,
      assignments: 1,
      audits: 1,
    });
  });

  it('rolls back the organization when a later insert fails', async () => {
    const input = createInput('ROLLBACK');

    await expect(
      repository.execute(input, null as unknown as string),
    ).rejects.toMatchObject({ code: '23502' });

    const result = await pool.query<CountRow>(
      'SELECT count(*)::integer AS count FROM organizations WHERE code = $1',
      [input.organizationCode],
    );
    expect(result.rows[0]?.count).toBe(0);
  });

  it('rejects a second execution without creating more records', async () => {
    await repository.execute(
      createInput('FIRST'),
      '$argon2id$integration-hash',
    );

    await expect(
      repository.execute(createInput('SECOND'), '$argon2id$integration-hash'),
    ).rejects.toBeInstanceOf(BootstrapAlreadyCompletedError);

    const result = await pool.query<CountRow>(
      "SELECT count(*)::integer AS count FROM organizations WHERE code LIKE 'HU27_TEST_%'",
    );
    expect(result.rows[0]?.count).toBe(1);
  });

  it('serializes concurrent attempts and creates a single SuperAdmin', async () => {
    const attempts = await Promise.allSettled([
      repository.execute(createInput('RACE_A'), '$argon2id$integration-hash'),
      repository.execute(createInput('RACE_B'), '$argon2id$integration-hash'),
    ]);

    expect(
      attempts.filter(({ status }) => status === 'fulfilled'),
    ).toHaveLength(1);
    expect(attempts.filter(({ status }) => status === 'rejected')).toHaveLength(
      1,
    );

    const result = await pool.query<CountRow>(
      `SELECT count(*)::integer AS count
       FROM user_role_assignments AS assignment
       JOIN organizations AS organization ON organization.id = assignment.organization_id
       WHERE organization.code LIKE 'HU27_TEST_%'
         AND assignment.scope = 'global' AND assignment.status = 'active'`,
    );
    expect(result.rows[0]?.count).toBe(1);
  });
});
