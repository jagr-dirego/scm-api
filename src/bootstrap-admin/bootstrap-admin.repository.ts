import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { DATABASE_POOL } from '../database/database.constants';
import {
  BootstrapAlreadyCompletedError,
  BootstrapConflictError,
  BootstrapPrerequisiteError,
} from './errors/bootstrap.errors';
import type { ValidatedBootstrapInput } from './schemas/bootstrap-input.schema';

const BOOTSTRAP_LOCK_KEY = 'dirego-scm:first-super-admin';

export interface BootstrapResult {
  organizationId: string;
  userId: string;
  membershipId: string;
  roleAssignmentId: string;
}

interface IdRow {
  id: string;
}

@Injectable()
export class BootstrapAdminRepository {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async execute(
    input: ValidatedBootstrapInput,
    passwordHash: string,
  ): Promise<BootstrapResult> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [BOOTSTRAP_LOCK_KEY],
      );

      const roleId = await this.findSuperAdminRole(client);
      await this.assertBootstrapAvailable(client, roleId, input);
      const organizationId = await this.insertOrganization(client, input);
      const userId = await this.insertUser(client, input, passwordHash);
      const membershipId = await this.insertMembership(
        client,
        organizationId,
        userId,
      );
      const roleAssignmentId = await this.insertRoleAssignment(
        client,
        organizationId,
        userId,
        roleId,
      );
      const result = { organizationId, userId, membershipId, roleAssignmentId };

      await this.insertAuditEvent(client, result);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async findSuperAdminRole(client: PoolClient): Promise<string> {
    const result = await client.query<IdRow>(
      `SELECT id FROM roles
       WHERE code = 'SuperAdmin' AND organization_id IS NULL
         AND is_system = true AND status = 'active'
       LIMIT 2`,
    );
    if (result.rowCount !== 1 || !result.rows[0]) {
      throw new BootstrapPrerequisiteError();
    }
    return result.rows[0].id;
  }

  private async assertBootstrapAvailable(
    client: PoolClient,
    roleId: string,
    input: ValidatedBootstrapInput,
  ): Promise<void> {
    const existingBootstrap = await client.query<IdRow>(
      `SELECT id FROM user_role_assignments
       WHERE role_id = $1 AND scope = 'global' AND status = 'active'
       LIMIT 1`,
      [roleId],
    );
    if (existingBootstrap.rowCount) {
      throw new BootstrapAlreadyCompletedError();
    }

    const conflict = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM organizations WHERE code = $1 OR slug = $2
       ) OR EXISTS (
         SELECT 1 FROM users WHERE email = $3
       ) AS exists`,
      [input.organizationCode, input.organizationSlug, input.email],
    );
    if (conflict.rows[0]?.exists === true) {
      throw new BootstrapConflictError();
    }
  }

  private async insertOrganization(
    client: PoolClient,
    input: ValidatedBootstrapInput,
  ): Promise<string> {
    const result = await client.query<IdRow>(
      'INSERT INTO organizations (code, name, slug) VALUES ($1, $2, $3) RETURNING id',
      [input.organizationCode, input.organizationName, input.organizationSlug],
    );
    return this.readInsertedId(result.rows[0]);
  }

  private async insertUser(
    client: PoolClient,
    input: ValidatedBootstrapInput,
    passwordHash: string,
  ): Promise<string> {
    const result = await client.query<IdRow>(
      'INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id',
      [input.email, input.displayName, passwordHash],
    );
    return this.readInsertedId(result.rows[0]);
  }

  private async insertMembership(
    client: PoolClient,
    organizationId: string,
    userId: string,
  ): Promise<string> {
    const result = await client.query<IdRow>(
      `INSERT INTO user_memberships (organization_id, user_id)
       VALUES ($1, $2) RETURNING id`,
      [organizationId, userId],
    );
    return this.readInsertedId(result.rows[0]);
  }

  private async insertRoleAssignment(
    client: PoolClient,
    organizationId: string,
    userId: string,
    roleId: string,
  ): Promise<string> {
    const result = await client.query<IdRow>(
      `INSERT INTO user_role_assignments (user_id, organization_id, role_id, scope)
       VALUES ($1, $2, $3, 'global') RETURNING id`,
      [userId, organizationId, roleId],
    );
    return this.readInsertedId(result.rows[0]);
  }

  private async insertAuditEvent(
    client: PoolClient,
    result: BootstrapResult,
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_logs
         (organization_id, action, entity_name, entity_id, after_data, metadata)
       VALUES ($1, 'system.bootstrap.completed', 'organizations', $1, $2, $3)`,
      [
        result.organizationId,
        JSON.stringify(result),
        JSON.stringify({ source: 'bootstrap-admin', roleCode: 'SuperAdmin' }),
      ],
    );
  }

  private readInsertedId(row: IdRow | undefined): string {
    if (!row) {
      throw new BootstrapPrerequisiteError();
    }
    return row.id;
  }
}
