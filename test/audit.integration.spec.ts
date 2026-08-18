import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditRepository } from '../src/observability/audit.repository';
import { AuditService } from '../src/observability/audit.service';
import { AuditValidationError } from '../src/observability/errors/audit.error';
import { RequestContextService } from '../src/observability/request-context.service';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'TEST_DATABASE_URL es obligatoria para la integracion de auditoria',
  );
}

const pool = new pg.Pool({ connectionString: databaseUrl });
const context = new RequestContextService();
const service = new AuditService(new AuditRepository(pool), context);
const requestId = '10000000-0000-4000-8000-000000000030';

interface Fixture {
  organizationId: string;
  actorUserId: string;
  actorSessionId: string;
  targetUserId: string;
}

const cleanup = async (): Promise<void> => {
  await pool.query('BEGIN');
  try {
    await pool.query(
      `DELETE FROM audit_logs WHERE actor_user_id IN (
         SELECT id FROM users WHERE email LIKE '%@hu30-audit.test'
       )`,
    );
    await pool.query(
      `DELETE FROM refresh_tokens WHERE session_id IN (
         SELECT s.id FROM sessions AS s
         JOIN users AS u ON u.id = s.user_id
         WHERE u.email LIKE '%@hu30-audit.test'
       )`,
    );
    await pool.query(
      `DELETE FROM sessions WHERE user_id IN (
         SELECT id FROM users WHERE email LIKE '%@hu30-audit.test'
       )`,
    );
    await pool.query(
      `DELETE FROM user_memberships WHERE user_id IN (
         SELECT id FROM users WHERE email LIKE '%@hu30-audit.test'
       )`,
    );
    await pool.query("DELETE FROM users WHERE email LIKE '%@hu30-audit.test'");
    await pool.query(
      "DELETE FROM organizations WHERE code LIKE 'HU30_AUDIT_%'",
    );
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
    [
      `HU30_AUDIT_${suffix}`,
      `Audit ${suffix}`,
      `hu30-audit-${suffix.toLowerCase()}`,
    ],
  );
  const actor = await pool.query<{ id: string }>(
    `INSERT INTO users (email, display_name, password_hash)
     VALUES ($1, $2, $3) RETURNING id`,
    [`actor-${suffix}@hu30-audit.test`, `Actor ${suffix}`, 'not-used'],
  );
  const target = await pool.query<{ id: string }>(
    `INSERT INTO users (email, display_name, password_hash)
     VALUES ($1, $2, $3) RETURNING id`,
    [`target-${suffix}@hu30-audit.test`, `Target ${suffix}`, 'not-used'],
  );
  await pool.query(
    `INSERT INTO user_memberships (organization_id, user_id)
     VALUES ($1, $2), ($1, $3)`,
    [organization.rows[0].id, actor.rows[0].id, target.rows[0].id],
  );
  const session = await pool.query<{ id: string }>(
    `INSERT INTO sessions
       (user_id, organization_id, idle_expires_at, absolute_expires_at)
     VALUES ($1, $2, now() + interval '1 hour', now() + interval '2 hours')
     RETURNING id`,
    [actor.rows[0].id, organization.rows[0].id],
  );
  return {
    organizationId: organization.rows[0].id,
    actorUserId: actor.rows[0].id,
    actorSessionId: session.rows[0].id,
    targetUserId: target.rows[0].id,
  };
};

const eventFor = (fixture: Fixture) => ({
  actor: {
    userId: fixture.actorUserId,
    organizationId: fixture.organizationId,
    sessionId: fixture.actorSessionId,
    tokenId: '10000000-0000-4000-8000-000000000031',
    issuedAt: 1,
    expiresAt: 2,
  },
  action: 'users.status_changed',
  entityName: 'users',
  entityId: fixture.targetUserId,
  beforeData: { status: 'active' },
  afterData: {
    status: 'inactive',
    deactivatedAt: '2026-08-18T18:00:00.000Z',
  },
  metadata: { reason: 'Integracion HU-30' },
  ipAddress: '127.0.0.1',
  userAgent: 'vitest-audit-integration',
});

describe.sequential('AuditService PostgreSQL integration', () => {
  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  it('persists approved fields with trusted actor and request context', async () => {
    const fixture = await createFixture('PERSIST');
    const auditId = await context.run({ requestId }, () =>
      service.record(eventFor(fixture)),
    );
    const result = await pool.query(
      `SELECT organization_id, actor_user_id, actor_session_id, action,
         entity_name, entity_id, before_data, after_data, metadata,
         host(ip_address) AS ip_address, user_agent, request_id
       FROM audit_logs WHERE id = $1`,
      [auditId],
    );

    expect(result.rows[0]).toEqual({
      organization_id: fixture.organizationId,
      actor_user_id: fixture.actorUserId,
      actor_session_id: fixture.actorSessionId,
      action: 'users.status_changed',
      entity_name: 'users',
      entity_id: fixture.targetUserId,
      before_data: { status: 'active' },
      after_data: {
        status: 'inactive',
        deactivatedAt: '2026-08-18T18:00:00.000Z',
      },
      metadata: { reason: 'Integracion HU-30' },
      ip_address: '127.0.0.1',
      user_agent: 'vitest-audit-integration',
      request_id: requestId,
    });
  });

  it('rolls back the audit when the caller transaction rolls back', async () => {
    const fixture = await createFixture('ROLLBACK');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await context.run({ requestId }, () =>
        service.record(eventFor(fixture), client),
      );
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    const count = await pool.query<{ total: string }>(
      'SELECT count(*) AS total FROM audit_logs WHERE actor_user_id = $1',
      [fixture.actorUserId],
    );

    expect(count.rows[0]?.total).toBe('0');
  });

  it('rejects secret fields without creating an audit row', async () => {
    const fixture = await createFixture('REJECT');

    await expect(
      context.run({ requestId }, () =>
        service.record({
          ...eventFor(fixture),
          afterData: { status: 'inactive', password: 'private-password' },
        }),
      ),
    ).rejects.toBeInstanceOf(AuditValidationError);
    const count = await pool.query<{ total: string }>(
      'SELECT count(*) AS total FROM audit_logs WHERE actor_user_id = $1',
      [fixture.actorUserId],
    );
    expect(count.rows[0]?.total).toBe('0');
  });
});
