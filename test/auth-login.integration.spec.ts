import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthRepository } from '../src/auth/auth.repository';
import { AuthService } from '../src/auth/auth.service';
import { AuthenticationError } from '../src/auth/errors/authentication.error';
import { PasswordService } from '../src/auth/password.service';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'TEST_DATABASE_URL es obligatoria para la integracion de login',
  );
}

const pool = new pg.Pool({ connectionString: databaseUrl });
const authOptions = { maxFailedAttempts: 5, lockoutMinutes: 15 };
const repository = new AuthRepository(pool, authOptions);
const passwordService = new PasswordService({
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
});
const service = new AuthService(repository, passwordService);
const context = { ipAddress: '127.0.0.1', userAgent: 'vitest-integration' };
const password = 'IntegrationPassword1!';

interface Fixture {
  organizationId: string;
  membershipId: string;
  userId: string;
  email: string;
}

interface UserStateRow {
  failed_login_count: number;
  locked_until: Date | null;
  last_login_at?: Date | null;
}

const cleanup = async (): Promise<void> => {
  await pool.query('BEGIN');
  try {
    await pool.query(
      "DELETE FROM auth_events WHERE email_attempted LIKE '%@hu27-auth.test'",
    );
    await pool.query(
      `DELETE FROM user_role_assignments WHERE user_id IN (
         SELECT id FROM users WHERE email LIKE '%@hu27-auth.test'
       )`,
    );
    await pool.query(
      `DELETE FROM user_memberships WHERE user_id IN (
         SELECT id FROM users WHERE email LIKE '%@hu27-auth.test'
       )`,
    );
    await pool.query("DELETE FROM users WHERE email LIKE '%@hu27-auth.test'");
    await pool.query(
      "DELETE FROM organizations WHERE code LIKE 'HU27_AUTH_TEST_%'",
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
      `HU27_AUTH_TEST_${suffix}`,
      `Auth test ${suffix}`,
      `hu27-auth-test-${suffix.toLowerCase()}`,
    ],
  );
  const email = `${suffix.toLowerCase()}@hu27-auth.test`;
  const user = await pool.query<{ id: string }>(
    `INSERT INTO users (email, display_name, password_hash)
     VALUES ($1, $2, $3) RETURNING id`,
    [email, `User ${suffix}`, await passwordService.hash(password)],
  );
  const membership = await pool.query<{ id: string }>(
    `INSERT INTO user_memberships (organization_id, user_id)
     VALUES ($1, $2) RETURNING id`,
    [organization.rows[0].id, user.rows[0].id],
  );
  return {
    organizationId: organization.rows[0].id,
    membershipId: membership.rows[0].id,
    userId: user.rows[0].id,
    email,
  };
};

describe.sequential('AuthService PostgreSQL integration', () => {
  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  it('authenticates, resets counters and records login.success', async () => {
    const fixture = await createFixture('SUCCESS');
    await pool.query(
      `UPDATE users SET failed_login_count = 2, locked_until = now() - interval '1 minute'
       WHERE id = $1`,
      [fixture.userId],
    );

    const identity = await service.login(
      { email: fixture.email, password },
      context,
    );
    const state = await pool.query<UserStateRow>(
      `SELECT failed_login_count, locked_until, last_login_at FROM users WHERE id = $1`,
      [fixture.userId],
    );
    const events = await pool.query(
      `SELECT event_type, success FROM auth_events WHERE user_id = $1 ORDER BY created_at`,
      [fixture.userId],
    );

    expect(identity).toMatchObject({
      userId: fixture.userId,
      organizationId: fixture.organizationId,
      membershipId: fixture.membershipId,
    });
    expect(state.rows[0]).toMatchObject({
      failed_login_count: 0,
      locked_until: null,
    });
    expect(state.rows[0]?.last_login_at).toBeInstanceOf(Date);
    expect(events.rows).toEqual([
      { event_type: 'login.success', success: true },
    ]);
  });

  it('increments failures and locks the account at the configured threshold', async () => {
    const fixture = await createFixture('LOCK');

    for (
      let attempt = 0;
      attempt < authOptions.maxFailedAttempts;
      attempt += 1
    ) {
      await expect(
        service.login(
          { email: fixture.email, password: 'WrongPassword1!' },
          context,
        ),
      ).rejects.toBeInstanceOf(AuthenticationError);
    }

    const state = await pool.query<UserStateRow>(
      'SELECT failed_login_count, locked_until FROM users WHERE id = $1',
      [fixture.userId],
    );
    const events = await pool.query<{ event_type: string }>(
      'SELECT event_type FROM auth_events WHERE user_id = $1 ORDER BY created_at',
      [fixture.userId],
    );
    expect(state.rows[0]?.failed_login_count).toBe(
      authOptions.maxFailedAttempts,
    );
    expect(state.rows[0]?.locked_until).toBeInstanceOf(Date);
    expect(
      events.rows.filter(({ event_type }) => event_type === 'login.failed'),
    ).toHaveLength(authOptions.maxFailedAttempts);
    expect(
      events.rows.filter(({ event_type }) => event_type === 'account.locked'),
    ).toHaveLength(1);
  });

  it('records a non-enumerable failure for an unknown email', async () => {
    const email = 'unknown@hu27-auth.test';

    await expect(
      service.login({ email, password }, context),
    ).rejects.toMatchObject({
      code: 'AUTH_INVALID_CREDENTIALS',
    });

    const event = await pool.query(
      `SELECT user_id, event_type, success, failure_reason
       FROM auth_events WHERE email_attempted = $1`,
      [email],
    );
    expect(event.rows).toEqual([
      {
        user_id: null,
        event_type: 'login.failed',
        success: false,
        failure_reason: 'invalid_credentials',
      },
    ]);
  });

  it.each([
    ['user', "UPDATE users SET status = 'inactive' WHERE id = $1"],
    [
      'membership',
      "UPDATE user_memberships SET status = 'inactive' WHERE id = $1",
    ],
    [
      'organization',
      "UPDATE organizations SET status = 'inactive' WHERE id = $1",
    ],
  ])(
    'rejects an inactive %s with the generic authentication error',
    async (entity, statement) => {
      const fixture = await createFixture(`INACTIVE_${entity.toUpperCase()}`);
      const id =
        entity === 'user'
          ? fixture.userId
          : entity === 'membership'
            ? fixture.membershipId
            : fixture.organizationId;
      await pool.query(statement, [id]);

      await expect(
        service.login({ email: fixture.email, password }, context),
      ).rejects.toMatchObject({
        code: 'AUTH_INVALID_CREDENTIALS',
      });
    },
  );
});
