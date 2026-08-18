import { createHash } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedIdentity } from '../src/auth/auth.repository';
import { RefreshTokenError } from '../src/auth/errors/session.error';
import { SessionRepository } from '../src/auth/session.repository';
import { SessionService } from '../src/auth/session.service';
import type { TokenOptions } from '../src/auth/token.constants';
import type { TokenService } from '../src/auth/token.service';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'TEST_DATABASE_URL es obligatoria para la integracion de sesiones',
  );
}

const pool = new pg.Pool({ connectionString: databaseUrl });
const repository = new SessionRepository(pool);
const options = {
  accessTtlSeconds: 600,
  sessionIdleTtlSeconds: 28_800,
  sessionAbsoluteTtlSeconds: 2_592_000,
} as TokenOptions;
const context = { ipAddress: '127.0.0.1', userAgent: 'vitest-session' };

interface Fixture {
  identity: AuthenticatedIdentity;
}

interface StoredSessionTokenRow {
  revoked_at: Date | null;
  token_hash: string;
  used_at: Date | null;
}

interface TokenFamilyRow {
  parent_token_id: string | null;
  used_at: Date | null;
  replaced_by_token_id: string | null;
  revoked_at: Date | null;
  reuse_detected_at?: Date | null;
}

interface SessionStateRow {
  revoked_at?: Date | null;
  revoked_reason: string | null;
}

const cleanup = async (): Promise<void> => {
  await pool.query('BEGIN');
  try {
    await pool.query(
      `DELETE FROM auth_events WHERE user_id IN (
         SELECT id FROM users WHERE email LIKE '%@hu28-session.test'
       )`,
    );
    await pool.query(
      `DELETE FROM refresh_tokens WHERE session_id IN (
         SELECT id FROM sessions WHERE user_id IN (
           SELECT id FROM users WHERE email LIKE '%@hu28-session.test'
         )
       )`,
    );
    await pool.query(
      `DELETE FROM sessions WHERE user_id IN (
         SELECT id FROM users WHERE email LIKE '%@hu28-session.test'
       )`,
    );
    await pool.query(
      `DELETE FROM user_memberships WHERE user_id IN (
         SELECT id FROM users WHERE email LIKE '%@hu28-session.test'
       )`,
    );
    await pool.query(
      "DELETE FROM users WHERE email LIKE '%@hu28-session.test'",
    );
    await pool.query(
      "DELETE FROM organizations WHERE code LIKE 'HU28_SESSION_TEST_%'",
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
      `HU28_SESSION_TEST_${suffix}`,
      `Session test ${suffix}`,
      `hu28-session-test-${suffix.toLowerCase()}`,
    ],
  );
  const email = `${suffix.toLowerCase()}@hu28-session.test`;
  const user = await pool.query<{ id: string }>(
    `INSERT INTO users (email, display_name, password_hash)
     VALUES ($1, $2, '$argon2id$integration-placeholder') RETURNING id`,
    [email, `Session user ${suffix}`],
  );
  const membership = await pool.query<{ id: string }>(
    `INSERT INTO user_memberships (organization_id, user_id)
     VALUES ($1, $2) RETURNING id`,
    [organization.rows[0].id, user.rows[0].id],
  );
  return {
    identity: {
      userId: user.rows[0].id,
      organizationId: organization.rows[0].id,
      membershipId: membership.rows[0].id,
      email,
      displayName: `Session user ${suffix}`,
    },
  };
};

const createService = (
  tokens = ['a'.repeat(43), 'b'.repeat(43), 'c'.repeat(43)],
) => {
  const queue = [...tokens];
  const tokenService = {
    generateRefreshToken: vi.fn(() => queue.shift() ?? 'z'.repeat(43)),
    hashRefreshToken: vi.fn((token: string) =>
      createHash('sha256').update(token).digest('base64url'),
    ),
    signAccessToken: vi.fn().mockResolvedValue('integration-access-token'),
  };
  return {
    service: new SessionService(
      repository,
      tokenService as unknown as TokenService,
      options,
    ),
    tokenService,
  };
};

describe.sequential('SessionService PostgreSQL integration', () => {
  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  it('creates one session and stores only the refresh token hash', async () => {
    const fixture = await createFixture('CREATE');
    const { service } = createService();

    const pair = await service.createSession(
      fixture.identity,
      context,
      'Chrome Windows',
    );
    const stored = await pool.query<StoredSessionTokenRow>(
      `SELECT s.revoked_at, rt.token_hash, rt.used_at
       FROM sessions AS s JOIN refresh_tokens AS rt ON rt.session_id = s.id
       WHERE s.id = $1`,
      [pair.sessionId],
    );
    const events = await pool.query<{ event_type: string }>(
      'SELECT event_type FROM auth_events WHERE session_id = $1',
      [pair.sessionId],
    );

    expect(pair.refreshToken).toBe('a'.repeat(43));
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]?.token_hash).not.toBe(pair.refreshToken);
    expect(stored.rows[0]).toMatchObject({ revoked_at: null, used_at: null });
    expect(events.rows).toEqual([{ event_type: 'session.created' }]);
  });

  it('rotates once, links the token family and extends idle expiration', async () => {
    const fixture = await createFixture('ROTATE');
    const { service } = createService();
    const created = await service.createSession(fixture.identity, context);

    const rotated = await service.rotateSession(created.refreshToken, context);
    const tokens = await pool.query<TokenFamilyRow>(
      `SELECT parent_token_id, used_at, replaced_by_token_id, revoked_at
       FROM refresh_tokens WHERE session_id = $1 ORDER BY issued_at`,
      [created.sessionId],
    );

    expect(rotated.refreshToken).toBe('b'.repeat(43));
    expect(tokens.rows).toHaveLength(2);
    expect(tokens.rows[0]?.used_at).toBeInstanceOf(Date);
    expect(tokens.rows[0]?.replaced_by_token_id).toBeTruthy();
    expect(tokens.rows[1]?.parent_token_id).toBeTruthy();
    expect(tokens.rows[1]?.revoked_at).toBeNull();
  });

  it('detects reuse and revokes the complete session and token family', async () => {
    const fixture = await createFixture('REUSE');
    const { service } = createService();
    const created = await service.createSession(fixture.identity, context);
    await service.rotateSession(created.refreshToken, context);

    await expect(
      service.rotateSession(created.refreshToken, context),
    ).rejects.toBeInstanceOf(RefreshTokenError);

    const session = await pool.query<SessionStateRow>(
      'SELECT revoked_at, revoked_reason FROM sessions WHERE id = $1',
      [created.sessionId],
    );
    const tokens = await pool.query<TokenFamilyRow>(
      `SELECT revoked_at, reuse_detected_at FROM refresh_tokens
       WHERE session_id = $1 ORDER BY issued_at`,
      [created.sessionId],
    );
    expect(session.rows[0]?.revoked_at).toBeInstanceOf(Date);
    expect(session.rows[0]?.revoked_reason).toBe('refresh_token_reuse');
    expect(
      tokens.rows.every(({ revoked_at }) => revoked_at instanceof Date),
    ).toBe(true);
    expect(tokens.rows[0]?.reuse_detected_at).toBeInstanceOf(Date);
  });

  it('revokes an expired idle session without issuing a replacement', async () => {
    const fixture = await createFixture('EXPIRED');
    const { service } = createService();
    const created = await service.createSession(fixture.identity, context);
    await pool.query(
      `UPDATE sessions SET idle_expires_at = now() - interval '1 second'
       WHERE id = $1`,
      [created.sessionId],
    );

    await expect(
      service.rotateSession(created.refreshToken, context),
    ).rejects.toBeInstanceOf(RefreshTokenError);

    const session = await pool.query<SessionStateRow>(
      'SELECT revoked_reason FROM sessions WHERE id = $1',
      [created.sessionId],
    );
    expect(session.rows[0]?.revoked_reason).toBe('session_expired');
  });

  it('revokes the session when its user is deactivated before refresh', async () => {
    const fixture = await createFixture('INACTIVE');
    const { service } = createService();
    const created = await service.createSession(fixture.identity, context);
    await pool.query("UPDATE users SET status = 'inactive' WHERE id = $1", [
      fixture.identity.userId,
    ]);

    await expect(
      service.rotateSession(created.refreshToken, context),
    ).rejects.toBeInstanceOf(RefreshTokenError);

    const session = await pool.query<SessionStateRow>(
      'SELECT revoked_reason FROM sessions WHERE id = $1',
      [created.sessionId],
    );
    expect(session.rows[0]?.revoked_reason).toBe('session_principal_inactive');
  });

  it('allows one concurrent refresh and revokes the session on the second use', async () => {
    const fixture = await createFixture('CONCURRENT');
    const { service } = createService();
    const created = await service.createSession(fixture.identity, context);

    const attempts = await Promise.allSettled([
      service.rotateSession(created.refreshToken, context),
      service.rotateSession(created.refreshToken, context),
    ]);

    expect(
      attempts.filter(({ status }) => status === 'fulfilled'),
    ).toHaveLength(1);
    expect(attempts.filter(({ status }) => status === 'rejected')).toHaveLength(
      1,
    );
    const session = await pool.query<SessionStateRow>(
      'SELECT revoked_reason FROM sessions WHERE id = $1',
      [created.sessionId],
    );
    expect(session.rows[0]?.revoked_reason).toBe('refresh_token_reuse');
  });
});
