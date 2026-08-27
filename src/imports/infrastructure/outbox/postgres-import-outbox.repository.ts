import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DATABASE_POOL } from '../../../database/database.constants';
import type {
  ClaimedImportOutboxEvent,
  ClaimImportOutboxEventsRequest,
  ImportOutboxRepository,
  RescheduleImportOutboxEventRequest,
} from '../../application/ports/import-outbox.repository.port';

interface ClaimedOutboxRow {
  id: string;
  import_batch_id: string;
  event_type: string;
  attempt_count: number;
  locked_by: string;
}

@Injectable()
export class PostgresImportOutboxRepository implements ImportOutboxRepository {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async claimPending(
    request: ClaimImportOutboxEventsRequest,
  ): Promise<readonly ClaimedImportOutboxEvent[]> {
    const lockDurationMs = this.validateClaimRequest(request);
    const result = await this.pool.query<ClaimedOutboxRow>(
      `WITH candidates AS (
         SELECT outbox.id
         FROM import_job_outbox AS outbox
         WHERE (
           (outbox.status IN ('pending', 'failed')
             AND outbox.available_at <= $2)
           OR
           (outbox.status = 'publishing'
             AND outbox.locked_at <=
               $2 - ($4::double precision * interval '1 millisecond'))
         )
         ORDER BY outbox.available_at, outbox.created_at, outbox.id
         FOR UPDATE SKIP LOCKED
         LIMIT $3
       )
       UPDATE import_job_outbox AS outbox
       SET status = 'publishing',
           attempt_count = outbox.attempt_count + 1,
           locked_at = $2,
           locked_by = $1,
           updated_at = $2
       FROM candidates
       WHERE outbox.id = candidates.id
       RETURNING outbox.id,
         outbox.import_batch_id,
         outbox.event_type,
         outbox.attempt_count,
         outbox.locked_by`,
      [request.workerId, request.now, request.limit, lockDurationMs],
    );

    return result.rows.map((row) => ({
      id: row.id,
      batchId: row.import_batch_id,
      eventType: row.event_type,
      attemptCount: row.attempt_count,
      lockedBy: row.locked_by,
      lockExpiresAt: request.lockExpiresAt,
    }));
  }

  async markPublished(
    eventId: string,
    workerId: string,
    publishedAt: Date,
  ): Promise<void> {
    const result = await this.pool.query(
      `UPDATE import_job_outbox
       SET status = 'published',
           published_at = $3,
           locked_at = null,
           locked_by = null,
           last_error_code = null,
           updated_at = $3
       WHERE id = $1
         AND status = 'publishing'
         AND locked_by = $2`,
      [eventId, workerId, publishedAt],
    );
    if (result.rowCount) return;

    const existing = await this.pool.query<{ status: string }>(
      `SELECT status FROM import_job_outbox WHERE id = $1`,
      [eventId],
    );
    if (existing.rows[0]?.status === 'published') return;

    throw new Error('Import outbox publish ownership lost');
  }

  async reschedule(request: RescheduleImportOutboxEventRequest): Promise<void> {
    if (!request.errorCode.trim()) {
      throw new Error('Import outbox errorCode must not be empty');
    }

    const result = await this.pool.query(
      `UPDATE import_job_outbox
       SET status = 'failed',
           available_at = $3,
           locked_at = null,
           locked_by = null,
           last_error_code = $4,
           updated_at = now()
       WHERE id = $1
         AND status = 'publishing'
         AND locked_by = $2`,
      [
        request.eventId,
        request.workerId,
        request.availableAt,
        request.errorCode,
      ],
    );
    if (!result.rowCount) {
      throw new Error('Import outbox reschedule ownership lost');
    }
  }

  private validateClaimRequest(request: ClaimImportOutboxEventsRequest) {
    const lockDurationMs =
      request.lockExpiresAt.getTime() - request.now.getTime();
    if (!request.workerId.trim()) {
      throw new Error('Import outbox workerId must not be empty');
    }
    if (!Number.isInteger(request.limit) || request.limit < 1) {
      throw new Error('Import outbox claim limit must be positive');
    }
    if (lockDurationMs <= 0) {
      throw new Error('Import outbox lock expiration must be in the future');
    }
    return lockDurationMs;
  }
}
