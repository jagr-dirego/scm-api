import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DATABASE_POOL } from '../database/database.constants';
import type { VerifiedAccessToken } from '../auth/token.service';
import type { AuthenticatedContext } from './schemas/authenticated-context.schema';

interface AuthenticatedContextRow {
  user_id: string;
  email: string;
  display_name: string;
  organization_id: string;
  organization_code: string;
  organization_name: string;
  membership_id: string;
  default_branch_id: string | null;
  default_branch_code: string | null;
  default_branch_name: string | null;
  session_id: string;
  idle_expires_at: Date;
  absolute_expires_at: Date;
  capabilities: string[];
}

@Injectable()
export class AuthenticatedContextRepository {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async find(
    identity: VerifiedAccessToken,
  ): Promise<AuthenticatedContext | null> {
    const result = await this.pool.query<AuthenticatedContextRow>(
      `WITH active_identity AS (
         SELECT
           u.id AS user_id, u.email, u.display_name,
           o.id AS organization_id, o.code AS organization_code,
           o.name AS organization_name,
           m.id AS membership_id,
           branch.id AS default_branch_id,
           branch.code AS default_branch_code,
           branch.name AS default_branch_name,
           session_record.id AS session_id,
           session_record.idle_expires_at,
           session_record.absolute_expires_at
         FROM sessions AS session_record
         JOIN users AS u ON u.id = session_record.user_id
         JOIN organizations AS o ON o.id = session_record.organization_id
         JOIN user_memberships AS m
           ON m.user_id = u.id
          AND m.organization_id = o.id
         LEFT JOIN branches AS branch
           ON branch.id = m.default_branch_id
          AND branch.organization_id = o.id
          AND branch.status = 'active'
         WHERE session_record.id = $1
           AND session_record.user_id = $2
           AND session_record.organization_id = $3
           AND session_record.revoked_at IS NULL
           AND session_record.idle_expires_at > now()
           AND session_record.absolute_expires_at > now()
           AND u.status = 'active'
           AND o.status = 'active'
           AND m.status = 'active'
       ), effective_permissions AS (
         SELECT permission.code,
           CASE
             WHEN permission_override.allowed IS NOT NULL
               THEN permission_override.allowed
             ELSE EXISTS (
               SELECT 1
               FROM active_identity AS identity
               JOIN user_role_assignments AS assignment
                 ON assignment.user_id = identity.user_id
                AND assignment.organization_id = identity.organization_id
                AND assignment.status = 'active'
               JOIN roles AS role_record
                 ON role_record.id = assignment.role_id
                AND role_record.status = 'active'
                AND (role_record.organization_id IS NULL
                     OR role_record.organization_id = identity.organization_id)
               JOIN role_permissions AS role_permission
                 ON role_permission.role_id = role_record.id
                AND role_permission.permission_id = permission.id
               WHERE assignment.scope = 'organization'
                  OR (
                    assignment.scope = 'branch'
                    AND EXISTS (
                      SELECT 1
                      FROM branches AS assigned_branch
                      WHERE assigned_branch.id = assignment.branch_id
                        AND assigned_branch.organization_id = identity.organization_id
                        AND assigned_branch.status = 'active'
                    )
                  )
                  OR (
                    assignment.scope = 'global'
                    AND role_record.organization_id IS NULL
                    AND role_record.is_system = true
                    AND role_record.code = 'SuperAdmin'
                  )
             )
           END AS allowed
         FROM permissions AS permission
         CROSS JOIN active_identity AS identity
         LEFT JOIN LATERAL (
           SELECT user_override.allowed
           FROM user_permission_overrides AS user_override
           WHERE user_override.user_id = identity.user_id
             AND user_override.organization_id = identity.organization_id
             AND user_override.permission_id = permission.id
             AND user_override.status = 'active'
           LIMIT 1
         ) AS permission_override ON true
         WHERE permission.code NOT LIKE 'imports.type.%'
           AND permission.code NOT LIKE 'imports.branch.%'
       )
       SELECT
         identity.user_id, identity.email, identity.display_name,
         identity.organization_id, identity.organization_code,
         identity.organization_name, identity.membership_id,
         identity.default_branch_id, identity.default_branch_code,
         identity.default_branch_name, identity.session_id,
         identity.idle_expires_at, identity.absolute_expires_at,
         COALESCE(
           array_agg(DISTINCT permission.code ORDER BY permission.code)
             FILTER (WHERE permission.allowed = true),
           ARRAY[]::text[]
         ) AS capabilities
       FROM active_identity AS identity
       LEFT JOIN effective_permissions AS permission ON permission.allowed = true
       GROUP BY
         identity.user_id, identity.email, identity.display_name,
         identity.organization_id, identity.organization_code,
         identity.organization_name, identity.membership_id,
         identity.default_branch_id, identity.default_branch_code,
         identity.default_branch_name, identity.session_id,
         identity.idle_expires_at, identity.absolute_expires_at`,
      [identity.sessionId, identity.userId, identity.organizationId],
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      user: {
        id: row.user_id,
        email: row.email,
        displayName: row.display_name,
      },
      organization: {
        id: row.organization_id,
        code: row.organization_code,
        name: row.organization_name,
      },
      membership: {
        id: row.membership_id,
        defaultBranch:
          row.default_branch_id &&
          row.default_branch_code &&
          row.default_branch_name
            ? {
                id: row.default_branch_id,
                code: row.default_branch_code,
                name: row.default_branch_name,
              }
            : null,
      },
      session: {
        id: row.session_id,
        idleExpiresAt: row.idle_expires_at.toISOString(),
        absoluteExpiresAt: row.absolute_expires_at.toISOString(),
      },
      capabilities: row.capabilities,
    };
  }
}
