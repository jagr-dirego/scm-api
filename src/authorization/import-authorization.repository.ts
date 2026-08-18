import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DATABASE_POOL } from '../database/database.constants';
import type {
  ImportAuthorizationDecision,
  ImportAuthorizationInput,
} from './import-authorization.types';

interface ImportAuthorizationRow {
  allowed: boolean;
  profile_id: string;
  profile_code: string;
  document_type_id: string;
  file_branch_id: string;
  file_structure_id: string;
  destination_table: string;
  parser_version: string;
}

@Injectable()
export class ImportAuthorizationRepository {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async resolve(
    input: ImportAuthorizationInput,
  ): Promise<ImportAuthorizationDecision> {
    const result = await this.pool.query<ImportAuthorizationRow>(
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
       ), target AS (
         SELECT profile.id AS profile_id, profile.code AS profile_code,
           profile.document_type_id, profile.file_branch_id,
           profile.file_structure_id, profile.destination_table,
           profile.parser_version, permission.id AS permission_id
         FROM import_profiles AS profile
         JOIN cat_document_types AS document_type
           ON document_type.id = profile.document_type_id
          AND document_type.code = $4
          AND document_type.is_active = true
         JOIN cat_file_branches AS file_branch
           ON file_branch.id = profile.file_branch_id
          AND file_branch.code = $5
          AND file_branch.is_active = true
         JOIN cat_file_structures AS file_structure
           ON file_structure.id = profile.file_structure_id
          AND file_structure.is_active = true
         JOIN permissions AS permission
           ON permission.code = $3
         WHERE profile.is_active = true
       ), overrides AS (
         SELECT
           permission_override.allowed AS action_allowed,
           type_override.allowed AS type_allowed,
           branch_override.allowed AS branch_allowed
         FROM active_identity AS identity
         CROSS JOIN target
         LEFT JOIN user_permission_overrides AS permission_override
           ON permission_override.user_id = identity.user_id
          AND permission_override.organization_id = identity.organization_id
          AND permission_override.permission_id = target.permission_id
          AND permission_override.status = 'active'
         LEFT JOIN user_import_type_overrides AS type_override
           ON type_override.user_id = identity.user_id
          AND type_override.organization_id = identity.organization_id
          AND type_override.document_type_id = target.document_type_id
          AND type_override.status = 'active'
         LEFT JOIN user_import_branch_overrides AS branch_override
           ON branch_override.user_id = identity.user_id
          AND branch_override.organization_id = identity.organization_id
          AND branch_override.file_branch_id = target.file_branch_id
          AND branch_override.status = 'active'
       ), applicable_roles AS (
         SELECT assignment.role_id,
           EXISTS (
             SELECT 1 FROM role_permissions AS role_permission
             WHERE role_permission.role_id = assignment.role_id
               AND role_permission.permission_id = target.permission_id
           ) AS allows_action,
           EXISTS (
             SELECT 1 FROM role_import_type_permissions AS type_permission
             WHERE type_permission.role_id = assignment.role_id
               AND type_permission.document_type_id = target.document_type_id
               AND type_permission.allowed = true
           ) AS allows_type,
           EXISTS (
             SELECT 1 FROM role_import_branch_permissions AS branch_permission
             WHERE branch_permission.role_id = assignment.role_id
               AND branch_permission.file_branch_id = target.file_branch_id
               AND branch_permission.allowed = true
           ) AS allows_branch
         FROM active_identity AS identity
         CROSS JOIN target
         JOIN user_role_assignments AS assignment
           ON assignment.user_id = identity.user_id
          AND assignment.organization_id = identity.organization_id
          AND assignment.status = 'active'
         JOIN roles AS role_record
           ON role_record.id = assignment.role_id
          AND role_record.status = 'active'
          AND (role_record.organization_id IS NULL
               OR role_record.organization_id = identity.organization_id)
         WHERE assignment.scope = 'organization'
            OR (assignment.scope = 'global'
                AND role_record.organization_id IS NULL
                AND role_record.is_system = true
                AND role_record.code = 'SuperAdmin')
       )
       SELECT target.profile_id, target.profile_code,
         target.document_type_id, target.file_branch_id,
         target.file_structure_id, target.destination_table,
         target.parser_version,
         CASE
           WHEN overrides.action_allowed = false
             OR overrides.type_allowed = false
             OR overrides.branch_allowed = false THEN false
           WHEN overrides.action_allowed = true
             AND overrides.type_allowed = true
             AND overrides.branch_allowed = true THEN true
           ELSE EXISTS (
             SELECT 1 FROM applicable_roles AS role_record
             WHERE (overrides.action_allowed = true OR role_record.allows_action)
               AND (overrides.type_allowed = true OR role_record.allows_type)
               AND (overrides.branch_allowed = true OR role_record.allows_branch)
           )
         END AS allowed
       FROM target
       CROSS JOIN active_identity
       CROSS JOIN overrides
       LIMIT 1`,
      [
        input.identity.userId,
        input.identity.organizationId,
        input.actionPermissionCode,
        input.documentTypeCode,
        input.fileBranchCode,
      ],
    );

    const row = result.rows[0];
    if (!row) return { allowed: false, profile: null };

    return {
      allowed: row.allowed,
      profile: {
        id: row.profile_id,
        code: row.profile_code,
        documentTypeId: row.document_type_id,
        fileBranchId: row.file_branch_id,
        fileStructureId: row.file_structure_id,
        destinationTable: row.destination_table,
        parserVersion: row.parser_version,
      },
    };
  }
}
