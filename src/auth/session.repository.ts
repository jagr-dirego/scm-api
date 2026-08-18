import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { DATABASE_POOL } from '../database/database.constants';
import type {
  AuthenticatedIdentity,
  AuthenticationContext,
} from './auth.repository';
import type { VerifiedAccessToken } from './token.service';

export interface SessionSummary {
  id: string;
  deviceName: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  lastSeenAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  createdAt: Date;
}

export interface CreateSessionRecordInput {
  identity: AuthenticatedIdentity;
  refreshTokenHash: string;
  issuedAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  deviceName?: string;
  context: AuthenticationContext;
}

export interface CreatedSessionRecord {
  sessionId: string;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
}

export interface RotateSessionRecordInput {
  presentedTokenHash: string;
  replacementTokenHash: string;
  rotatedAt: Date;
  proposedIdleExpiresAt: Date;
  context: AuthenticationContext;
}

export type RotateSessionRecordResult =
  | {
      status: 'rotated';
      sessionId: string;
      userId: string;
      organizationId: string;
      idleExpiresAt: Date;
      absoluteExpiresAt: Date;
    }
  | { status: 'invalid' | 'reused' | 'expired' };

interface IdRow {
  id: string;
}

interface RefreshRow {
  token_id: string;
  session_id: string;
  token_expires_at: Date;
  used_at: Date | null;
  token_revoked_at: Date | null;
  replaced_by_token_id: string | null;
  user_id: string;
  organization_id: string;
  idle_expires_at: Date;
  absolute_expires_at: Date;
  session_revoked_at: Date | null;
  principal_active: boolean;
}

@Injectable()
export class SessionRepository {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async create(input: CreateSessionRecordInput): Promise<CreatedSessionRecord> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const eligibility = await client.query(
        `SELECT 1
         FROM users AS u
         JOIN user_memberships AS m ON m.user_id = u.id
         JOIN organizations AS o ON o.id = m.organization_id
         WHERE u.id = $1 AND m.id = $2 AND o.id = $3
           AND u.status = 'active' AND m.status = 'active' AND o.status = 'active'
           AND (u.locked_until IS NULL OR u.locked_until <= $4)
         FOR UPDATE OF u, m, o`,
        [
          input.identity.userId,
          input.identity.membershipId,
          input.identity.organizationId,
          input.issuedAt,
        ],
      );
      if (!eligibility.rowCount) {
        throw new Error('Session eligibility rejected');
      }

      const session = await client.query<IdRow>(
        `INSERT INTO sessions
           (user_id, organization_id, device_name, ip_address, user_agent,
            last_seen_at, idle_expires_at, absolute_expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          input.identity.userId,
          input.identity.organizationId,
          input.deviceName ?? null,
          input.context.ipAddress ?? null,
          input.context.userAgent ?? null,
          input.issuedAt,
          input.idleExpiresAt,
          input.absoluteExpiresAt,
        ],
      );
      const sessionId = this.readId(session.rows[0]);
      await client.query(
        `INSERT INTO refresh_tokens
           (session_id, token_hash, issued_at, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [
          sessionId,
          input.refreshTokenHash,
          input.issuedAt,
          input.idleExpiresAt,
        ],
      );
      await this.insertEvent(client, {
        sessionId,
        userId: input.identity.userId,
        organizationId: input.identity.organizationId,
        eventType: 'session.created',
        success: true,
        failureReason: null,
        context: input.context,
      });
      await client.query('COMMIT');
      return {
        sessionId,
        idleExpiresAt: input.idleExpiresAt,
        absoluteExpiresAt: input.absoluteExpiresAt,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async isAccessSessionActive(claims: VerifiedAccessToken): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1
       FROM sessions AS s
       JOIN users AS u ON u.id = s.user_id
       JOIN organizations AS o ON o.id = s.organization_id
       WHERE s.id = $1 AND s.user_id = $2 AND s.organization_id = $3
         AND s.revoked_at IS NULL
         AND s.idle_expires_at > now()
         AND s.absolute_expires_at > now()
         AND u.status = 'active'
         AND o.status = 'active'
         AND EXISTS (
           SELECT 1 FROM user_memberships AS m
           WHERE m.user_id = s.user_id
             AND m.organization_id = s.organization_id
             AND m.status = 'active'
         )`,
      [claims.sessionId, claims.userId, claims.organizationId],
    );
    return Boolean(result.rowCount);
  }

  async listActive(
    userId: string,
    organizationId: string,
  ): Promise<SessionSummary[]> {
    const result = await this.pool.query<{
      id: string;
      device_name: string | null;
      ip_address: string | null;
      user_agent: string | null;
      last_seen_at: Date;
      idle_expires_at: Date;
      absolute_expires_at: Date;
      created_at: Date;
    }>(
      `SELECT id, device_name, host(ip_address) AS ip_address, user_agent,
              last_seen_at, idle_expires_at, absolute_expires_at, created_at
       FROM sessions
       WHERE user_id = $1 AND organization_id = $2
         AND revoked_at IS NULL
         AND idle_expires_at > now()
         AND absolute_expires_at > now()
       ORDER BY last_seen_at DESC, created_at DESC`,
      [userId, organizationId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      deviceName: row.device_name,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      lastSeenAt: row.last_seen_at,
      idleExpiresAt: row.idle_expires_at,
      absoluteExpiresAt: row.absolute_expires_at,
      createdAt: row.created_at,
    }));
  }

  async revokeOwned(
    actor: VerifiedAccessToken,
    targetSessionId: string,
    context: AuthenticationContext,
  ): Promise<void> {
    await this.revokeOwnedSessions(actor, context, targetSessionId);
  }

  async revokeAllOwned(
    actor: VerifiedAccessToken,
    context: AuthenticationContext,
  ): Promise<void> {
    await this.revokeOwnedSessions(actor, context);
  }

  async rotate(
    input: RotateSessionRecordInput,
  ): Promise<RotateSessionRecordResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<RefreshRow>(
        `SELECT
           rt.id AS token_id, rt.session_id, rt.expires_at AS token_expires_at,
           rt.used_at, rt.revoked_at AS token_revoked_at, rt.replaced_by_token_id,
           s.user_id, s.organization_id, s.idle_expires_at,
           s.absolute_expires_at, s.revoked_at AS session_revoked_at,
           (
             u.status = 'active' AND o.status = 'active' AND EXISTS (
               SELECT 1 FROM user_memberships AS m
               WHERE m.user_id = s.user_id
                 AND m.organization_id = s.organization_id
                 AND m.status = 'active'
             )
           ) AS principal_active
         FROM refresh_tokens AS rt
         JOIN sessions AS s ON s.id = rt.session_id
         JOIN users AS u ON u.id = s.user_id
         JOIN organizations AS o ON o.id = s.organization_id
         WHERE rt.token_hash = $1
         FOR UPDATE OF rt, s`,
        [input.presentedTokenHash],
      );
      const current = result.rows[0];
      if (!current) {
        await client.query('ROLLBACK');
        return { status: 'invalid' };
      }

      if (
        current.used_at ||
        current.token_revoked_at ||
        current.replaced_by_token_id
      ) {
        await this.revokeForReuse(client, current, input);
        await client.query('COMMIT');
        return { status: 'reused' };
      }

      if (current.session_revoked_at) {
        await client.query('ROLLBACK');
        return { status: 'invalid' };
      }

      if (!current.principal_active) {
        await this.expireSession(
          client,
          current,
          input,
          'session_principal_inactive',
        );
        await client.query('COMMIT');
        return { status: 'expired' };
      }

      if (
        current.token_expires_at <= input.rotatedAt ||
        current.idle_expires_at <= input.rotatedAt ||
        current.absolute_expires_at <= input.rotatedAt
      ) {
        await this.expireSession(client, current, input, 'session_expired');
        await client.query('COMMIT');
        return { status: 'expired' };
      }

      const idleExpiresAt =
        input.proposedIdleExpiresAt < current.absolute_expires_at
          ? input.proposedIdleExpiresAt
          : current.absolute_expires_at;
      const replacement = await client.query<IdRow>(
        `INSERT INTO refresh_tokens
           (session_id, token_hash, parent_token_id, issued_at, expires_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [
          current.session_id,
          input.replacementTokenHash,
          current.token_id,
          input.rotatedAt,
          idleExpiresAt,
        ],
      );
      const replacementId = this.readId(replacement.rows[0]);
      await client.query(
        `UPDATE refresh_tokens
         SET used_at = $2, replaced_by_token_id = $3
         WHERE id = $1`,
        [current.token_id, input.rotatedAt, replacementId],
      );
      await client.query(
        `UPDATE sessions
         SET last_seen_at = $2, idle_expires_at = $3
         WHERE id = $1`,
        [current.session_id, input.rotatedAt, idleExpiresAt],
      );
      await this.insertEvent(client, {
        sessionId: current.session_id,
        userId: current.user_id,
        organizationId: current.organization_id,
        eventType: 'refresh.succeeded',
        success: true,
        failureReason: null,
        context: input.context,
      });
      await client.query('COMMIT');
      return {
        status: 'rotated',
        sessionId: current.session_id,
        userId: current.user_id,
        organizationId: current.organization_id,
        idleExpiresAt,
        absoluteExpiresAt: current.absolute_expires_at,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeAfterTokenFailure(sessionId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const session = await client.query<{
        user_id: string;
        organization_id: string;
      }>(
        `UPDATE sessions
         SET revoked_at = COALESCE(revoked_at, now()),
             revoked_reason = COALESCE(revoked_reason, 'access_token_signing_failed')
         WHERE id = $1
         RETURNING user_id, organization_id`,
        [sessionId],
      );
      await client.query(
        `UPDATE refresh_tokens
         SET revoked_at = COALESCE(revoked_at, now())
         WHERE session_id = $1`,
        [sessionId],
      );
      const row = session.rows[0];
      if (row) {
        await this.insertEvent(client, {
          sessionId,
          userId: row.user_id,
          organizationId: row.organization_id,
          eventType: 'session.revoked',
          success: false,
          failureReason: 'access_token_signing_failed',
          context: {},
        });
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeByRefreshToken(
    tokenHash: string,
    context: AuthenticationContext,
  ): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{
        session_id: string;
        user_id: string;
        organization_id: string;
      }>(
        `SELECT s.id AS session_id, s.user_id, s.organization_id
         FROM refresh_tokens AS rt
         JOIN sessions AS s ON s.id = rt.session_id
         WHERE rt.token_hash = $1
         FOR UPDATE OF rt, s`,
        [tokenHash],
      );
      const session = result.rows[0];
      if (!session) {
        await client.query('ROLLBACK');
        return false;
      }

      await client.query(
        `UPDATE sessions
         SET revoked_at = COALESCE(revoked_at, now()),
             revoked_reason = COALESCE(revoked_reason, 'user_logout')
         WHERE id = $1`,
        [session.session_id],
      );
      await client.query(
        `UPDATE refresh_tokens
         SET revoked_at = COALESCE(revoked_at, now())
         WHERE session_id = $1`,
        [session.session_id],
      );
      await this.insertEvent(client, {
        sessionId: session.session_id,
        userId: session.user_id,
        organizationId: session.organization_id,
        eventType: 'logout.succeeded',
        success: true,
        failureReason: null,
        context,
      });
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async revokeOwnedSessions(
    actor: VerifiedAccessToken,
    context: AuthenticationContext,
    targetSessionId?: string,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<{ id: string }>(
        `SELECT id
         FROM sessions
         WHERE user_id = $1 AND organization_id = $2
           AND ($3::uuid IS NULL OR id = $3)
           AND revoked_at IS NULL
         FOR UPDATE`,
        [actor.userId, actor.organizationId, targetSessionId ?? null],
      );
      const sessionIds = result.rows.map(({ id }) => id);
      if (sessionIds.length > 0) {
        await client.query(
          `UPDATE sessions
           SET revoked_at = now(),
               revoked_by_user_id = $2,
               revoked_reason = $3
           WHERE id = ANY($1::uuid[])`,
          [
            sessionIds,
            actor.userId,
            targetSessionId ? 'user_revoked_session' : 'user_logout_all',
          ],
        );
        await client.query(
          `UPDATE refresh_tokens
           SET revoked_at = COALESCE(revoked_at, now())
           WHERE session_id = ANY($1::uuid[])`,
          [sessionIds],
        );
        await this.insertEvent(client, {
          sessionId: actor.sessionId,
          userId: actor.userId,
          organizationId: actor.organizationId,
          eventType: targetSessionId
            ? 'session.revoked'
            : 'sessions.revoked_all',
          success: true,
          failureReason: null,
          context,
        });
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async revokeForReuse(
    client: PoolClient,
    current: RefreshRow,
    input: RotateSessionRecordInput,
  ): Promise<void> {
    await client.query(
      `UPDATE refresh_tokens
       SET reuse_detected_at = COALESCE(reuse_detected_at, $2)
       WHERE id = $1`,
      [current.token_id, input.rotatedAt],
    );
    await client.query(
      `UPDATE sessions
       SET revoked_at = COALESCE(revoked_at, $2),
           revoked_reason = COALESCE(revoked_reason, 'refresh_token_reuse')
       WHERE id = $1`,
      [current.session_id, input.rotatedAt],
    );
    await client.query(
      `UPDATE refresh_tokens
       SET revoked_at = COALESCE(revoked_at, $2)
       WHERE session_id = $1`,
      [current.session_id, input.rotatedAt],
    );
    await this.insertEvent(client, {
      sessionId: current.session_id,
      userId: current.user_id,
      organizationId: current.organization_id,
      eventType: 'refresh.reuse_detected',
      success: false,
      failureReason: 'refresh_token_reuse',
      context: input.context,
    });
  }

  private async expireSession(
    client: PoolClient,
    current: RefreshRow,
    input: RotateSessionRecordInput,
    failureReason: 'session_expired' | 'session_principal_inactive',
  ): Promise<void> {
    await client.query(
      `UPDATE sessions
       SET revoked_at = COALESCE(revoked_at, $2),
           revoked_reason = COALESCE(revoked_reason, $3)
       WHERE id = $1`,
      [current.session_id, input.rotatedAt, failureReason],
    );
    await client.query(
      `UPDATE refresh_tokens
       SET revoked_at = COALESCE(revoked_at, $2)
       WHERE session_id = $1`,
      [current.session_id, input.rotatedAt],
    );
    await this.insertEvent(client, {
      sessionId: current.session_id,
      userId: current.user_id,
      organizationId: current.organization_id,
      eventType: 'refresh.failed',
      success: false,
      failureReason,
      context: input.context,
    });
  }

  private insertEvent(
    client: PoolClient,
    event: {
      sessionId: string;
      userId: string;
      organizationId: string;
      eventType: string;
      success: boolean;
      failureReason: string | null;
      context: AuthenticationContext;
    },
  ): Promise<unknown> {
    return client.query(
      `INSERT INTO auth_events
         (organization_id, user_id, session_id, event_type, success,
          failure_reason, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        event.organizationId,
        event.userId,
        event.sessionId,
        event.eventType,
        event.success,
        event.failureReason,
        event.context.ipAddress ?? null,
        event.context.userAgent ?? null,
      ],
    );
  }

  private readId(row: IdRow | undefined): string {
    if (!row) throw new Error('Expected inserted identifier');
    return row.id;
  }
}
