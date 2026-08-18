import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { DATABASE_POOL } from '../database/database.constants';
import {
  AUTH_SECURITY_OPTIONS,
  type AuthSecurityOptions,
} from './auth.constants';
import type { AuthenticationFailureReason } from './errors/authentication.error';

export interface AuthMembershipRecord {
  id: string;
  status: string;
  organizationId: string;
  organizationCode: string;
  organizationStatus: string;
}

export interface AuthUserRecord {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  status: string;
  failedLoginCount: number;
  lockedUntil: Date | null;
  memberships: AuthMembershipRecord[];
}

export interface AuthenticationContext {
  ipAddress?: string;
  userAgent?: string;
}

export interface AuthenticatedIdentity {
  userId: string;
  organizationId: string;
  membershipId: string;
  email: string;
  displayName: string;
}

interface CandidateRow {
  user_id: string;
  email: string;
  display_name: string;
  password_hash: string;
  user_status: string;
  failed_login_count: number;
  locked_until: Date | null;
  membership_id: string | null;
  membership_status: string | null;
  organization_id: string | null;
  organization_code: string | null;
  organization_status: string | null;
}

interface LockedUserRow {
  failed_login_count: number;
  locked_until: Date | null;
}

@Injectable()
export class AuthRepository {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    @Inject(AUTH_SECURITY_OPTIONS)
    private readonly options: AuthSecurityOptions,
  ) {}

  async findByEmail(email: string): Promise<AuthUserRecord | null> {
    const result = await this.pool.query<CandidateRow>(
      `SELECT
         u.id AS user_id, u.email, u.display_name, u.password_hash,
         u.status AS user_status, u.failed_login_count, u.locked_until,
         m.id AS membership_id, m.status AS membership_status,
         o.id AS organization_id, o.code AS organization_code,
         o.status AS organization_status
       FROM users AS u
       LEFT JOIN user_memberships AS m ON m.user_id = u.id
       LEFT JOIN organizations AS o ON o.id = m.organization_id
       WHERE u.email = $1
       ORDER BY o.code NULLS LAST`,
      [email],
    );

    const first = result.rows[0];
    if (!first) {
      return null;
    }

    return {
      id: first.user_id,
      email: first.email,
      displayName: first.display_name,
      passwordHash: first.password_hash,
      status: first.user_status,
      failedLoginCount: first.failed_login_count,
      lockedUntil: first.locked_until,
      memberships: result.rows.flatMap((row) =>
        row.membership_id &&
        row.membership_status &&
        row.organization_id &&
        row.organization_code &&
        row.organization_status
          ? [
              {
                id: row.membership_id,
                status: row.membership_status,
                organizationId: row.organization_id,
                organizationCode: row.organization_code,
                organizationStatus: row.organization_status,
              },
            ]
          : [],
      ),
    };
  }

  async recordAnonymousFailure(
    email: string,
    reason: AuthenticationFailureReason,
    context: AuthenticationContext,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO auth_events
         (event_type, email_attempted, success, failure_reason, ip_address, user_agent)
       VALUES ('login.failed', $1, false, $2, $3, $4)`,
      [email, reason, context.ipAddress ?? null, context.userAgent ?? null],
    );
  }

  async recordKnownFailure(
    user: AuthUserRecord,
    organizationId: string | null,
    reason: AuthenticationFailureReason,
    incrementAttempts: boolean,
    context: AuthenticationContext,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const lockedUser = await client.query<LockedUserRow>(
        `SELECT failed_login_count, locked_until
         FROM users WHERE id = $1 FOR UPDATE`,
        [user.id],
      );
      const current = lockedUser.rows[0];
      if (!current) {
        await client.query('ROLLBACK');
        return;
      }

      let accountLocked = false;
      if (incrementAttempts) {
        const nextCount = current.failed_login_count + 1;
        accountLocked =
          nextCount >= this.options.maxFailedAttempts &&
          (!current.locked_until || current.locked_until <= new Date());
        await client.query(
          `UPDATE users
           SET failed_login_count = $2,
               locked_until = CASE WHEN $3 THEN now() + ($4 * interval '1 minute') ELSE locked_until END,
               updated_at = now()
           WHERE id = $1`,
          [user.id, nextCount, accountLocked, this.options.lockoutMinutes],
        );
      }

      await this.insertEvent(client, {
        eventType: 'login.failed',
        email: user.email,
        success: false,
        reason,
        userId: user.id,
        organizationId,
        context,
      });
      if (accountLocked) {
        await this.insertEvent(client, {
          eventType: 'account.locked',
          email: user.email,
          success: false,
          reason: 'account_locked',
          userId: user.id,
          organizationId,
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

  async confirmSuccess(
    user: AuthUserRecord,
    membership: AuthMembershipRecord,
    replacementPasswordHash: string | null,
    context: AuthenticationContext,
  ): Promise<AuthenticatedIdentity | null> {
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
           AND (u.locked_until IS NULL OR u.locked_until <= now())
         FOR UPDATE OF u, m, o`,
        [user.id, membership.id, membership.organizationId],
      );
      if (!eligibility.rowCount) {
        await client.query('ROLLBACK');
        return null;
      }

      await client.query(
        `UPDATE users
         SET failed_login_count = 0, locked_until = NULL, last_login_at = now(),
             password_hash = COALESCE($2, password_hash), updated_at = now()
         WHERE id = $1`,
        [user.id, replacementPasswordHash],
      );
      await this.insertEvent(client, {
        eventType: 'login.success',
        email: user.email,
        success: true,
        reason: null,
        userId: user.id,
        organizationId: membership.organizationId,
        context,
      });
      await client.query('COMMIT');
      return {
        userId: user.id,
        organizationId: membership.organizationId,
        membershipId: membership.id,
        email: user.email,
        displayName: user.displayName,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private insertEvent(
    client: PoolClient,
    event: {
      eventType: string;
      email: string;
      success: boolean;
      reason: AuthenticationFailureReason | null;
      userId: string;
      organizationId: string | null;
      context: AuthenticationContext;
    },
  ): Promise<unknown> {
    return client.query(
      `INSERT INTO auth_events
         (organization_id, user_id, event_type, email_attempted, success,
          failure_reason, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        event.organizationId,
        event.userId,
        event.eventType,
        event.email,
        event.success,
        event.reason,
        event.context.ipAddress ?? null,
        event.context.userAgent ?? null,
      ],
    );
  }
}
