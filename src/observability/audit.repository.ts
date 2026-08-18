import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DATABASE_POOL } from '../database/database.constants';
import type { AuditTransaction, PersistedAuditEvent } from './audit.types';

@Injectable()
export class AuditRepository {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async insert(
    event: PersistedAuditEvent,
    transaction?: AuditTransaction,
  ): Promise<string> {
    const executor = transaction ?? this.pool;
    const result = await executor.query<{ id: string }>(
      `INSERT INTO audit_logs
         (organization_id, actor_user_id, actor_session_id, action,
          entity_name, entity_id, before_data, after_data, metadata,
          ip_address, user_agent, request_id)
       SELECT
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
       FROM sessions AS session_record
       JOIN users AS actor ON actor.id = session_record.user_id
       JOIN organizations AS organization
         ON organization.id = session_record.organization_id
       JOIN user_memberships AS membership
         ON membership.user_id = actor.id
        AND membership.organization_id = organization.id
       WHERE session_record.id = $3
         AND session_record.user_id = $2
         AND session_record.organization_id = $1
         AND session_record.revoked_at IS NULL
         AND session_record.idle_expires_at > now()
         AND session_record.absolute_expires_at > now()
         AND actor.status = 'active'
         AND organization.status = 'active'
         AND membership.status = 'active'
       RETURNING id`,
      [
        event.organizationId,
        event.actorUserId,
        event.actorSessionId,
        event.action,
        event.entityName,
        event.entityId,
        event.beforeData ?? null,
        event.afterData ?? null,
        event.metadata ?? null,
        event.ipAddress ?? null,
        event.userAgent ?? null,
        event.requestId,
      ],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error('Audit insert did not return an id');
    return id;
  }
}
