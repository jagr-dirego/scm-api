import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DATABASE_POOL } from '../database/database.constants';
import type {
  AuthorizationInput,
  PermissionDecision,
} from './authorization.types';

interface PermissionDecisionRow {
  permission_code: string;
  allowed: boolean;
}

@Injectable()
export class AuthorizationRepository {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async resolvePermissions(
    input: AuthorizationInput,
  ): Promise<PermissionDecision[]> {
    if (input.permissionCodes.length === 0) return [];

    const result = await this.pool.query<PermissionDecisionRow>(
      `WITH active_identity AS (
         SELECT u.id AS user_id, m.organization_id
         FROM users AS u
         JOIN user_memberships AS m ON m.user_id = u.id
         JOIN organizations AS o ON o.id = m.organization_id
         WHERE u.id = $1
           AND m.organization_id = $2
           AND u.status = 'active'
           AND m.status = 'active'
           AND o.status = 'active'
       ), requested_permissions AS (
         SELECT p.id, p.code
         FROM permissions AS p
         WHERE p.code = ANY($3::text[])
           AND p.status = 'active'
       ), valid_branch AS (
         SELECT b.id
         FROM branches AS b
         JOIN active_identity AS identity
           ON identity.organization_id = b.organization_id
         WHERE b.id = $4::uuid
           AND b.status = 'active'
       )
       SELECT permission.code AS permission_code,
         CASE
           WHEN override.allowed IS NOT NULL THEN override.allowed
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
              AND role_permission.allowed = true
             WHERE
               (assignment.scope = 'organization'
                OR (assignment.scope = 'branch'
                    AND assignment.branch_id = (SELECT id FROM valid_branch))
                OR (assignment.scope = 'global'
                    AND role_record.organization_id IS NULL
                    AND role_record.is_system = true
                    AND role_record.code = 'SuperAdmin'))
           )
         END AS allowed
       FROM requested_permissions AS permission
       CROSS JOIN active_identity AS identity
       LEFT JOIN LATERAL (
         SELECT permission_override.allowed
         FROM user_permission_overrides AS permission_override
         WHERE permission_override.user_id = identity.user_id
           AND permission_override.organization_id = identity.organization_id
           AND permission_override.permission_id = permission.id
           AND permission_override.status = 'active'
         LIMIT 1
       ) AS override ON true`,
      [
        input.identity.userId,
        input.identity.organizationId,
        input.permissionCodes,
        input.branchId ?? null,
      ],
    );

    return result.rows.map((row) => ({
      permissionCode: row.permission_code,
      allowed: row.allowed,
    }));
  }
}
