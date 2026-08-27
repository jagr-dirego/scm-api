import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { IMPORT_BATCH_QUEUED_EVENT } from '../src/imports/application/dispatcher.contracts';
import { PostgresImportOutboxRepository } from '../src/imports/infrastructure/outbox/postgres-import-outbox.repository';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const prefix = 'HU36_OUTBOX_';

describeWithDatabase('PostgresImportOutboxRepository integration', () => {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const repository = new PostgresImportOutboxRepository(pool);

  beforeEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  it('claims one pending event atomically and increments its attempt', async () => {
    const event = await createEvent('CLAIM');
    const now = new Date('2026-08-27T18:00:00.000Z');
    const lockExpiresAt = new Date('2026-08-27T18:01:00.000Z');

    const [firstClaim, secondClaim] = await Promise.all([
      repository.claimPending({
        workerId: 'worker-a',
        now,
        lockExpiresAt,
        limit: 1,
      }),
      repository.claimPending({
        workerId: 'worker-b',
        now,
        lockExpiresAt,
        limit: 1,
      }),
    ]);

    expect([...firstClaim, ...secondClaim]).toHaveLength(1);
    expect([...firstClaim, ...secondClaim][0]).toMatchObject({
      id: event.eventId,
      batchId: event.batchId,
      eventType: IMPORT_BATCH_QUEUED_EVENT,
      attemptCount: 1,
      lockExpiresAt,
    });
  });

  it('reclaims an expired publishing lock', async () => {
    const event = await createEvent('STALE', {
      status: 'publishing',
      lockedAt: new Date('2026-08-27T17:58:00.000Z'),
      lockedBy: 'stale-worker',
    });

    const claimed = await repository.claimPending({
      workerId: 'recovery-worker',
      now: new Date('2026-08-27T18:00:00.000Z'),
      lockExpiresAt: new Date('2026-08-27T18:01:00.000Z'),
      limit: 1,
    });

    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({
      id: event.eventId,
      attemptCount: 1,
      lockedBy: 'recovery-worker',
    });
  });

  it('marks an owned event as published idempotently', async () => {
    const event = await createEvent('PUBLISHED');
    const now = new Date('2026-08-27T18:00:00.000Z');
    await repository.claimPending({
      workerId: 'worker-publish',
      now,
      lockExpiresAt: new Date('2026-08-27T18:01:00.000Z'),
      limit: 1,
    });

    await repository.markPublished(event.eventId, 'worker-publish', now);
    await repository.markPublished(event.eventId, 'worker-publish', now);

    await expect(readEvent(event.eventId)).resolves.toMatchObject({
      status: 'published',
      published_at: now,
      locked_by: null,
      last_error_code: null,
    });
  });

  it('reschedules only an event owned by the worker', async () => {
    const event = await createEvent('RESCHEDULE');
    const now = new Date('2026-08-27T18:00:00.000Z');
    const availableAt = new Date('2026-08-27T18:00:30.000Z');
    await repository.claimPending({
      workerId: 'worker-retry',
      now,
      lockExpiresAt: new Date('2026-08-27T18:01:00.000Z'),
      limit: 1,
    });

    await expect(
      repository.reschedule({
        eventId: event.eventId,
        workerId: 'other-worker',
        availableAt,
        errorCode: 'REDIS_UNAVAILABLE',
      }),
    ).rejects.toThrow('Import outbox reschedule ownership lost');

    await repository.reschedule({
      eventId: event.eventId,
      workerId: 'worker-retry',
      availableAt,
      errorCode: 'REDIS_UNAVAILABLE',
    });

    await expect(readEvent(event.eventId)).resolves.toMatchObject({
      status: 'failed',
      available_at: availableAt,
      locked_by: null,
      last_error_code: 'REDIS_UNAVAILABLE',
    });
  });

  async function createEvent(
    suffix: string,
    overrides: {
      status?: string;
      lockedAt?: Date;
      lockedBy?: string;
    } = {},
  ) {
    const organization = await pool.query<{ id: string }>(
      `INSERT INTO organizations (code, name, slug)
       VALUES ($1, $2, $3) RETURNING id`,
      [
        `${prefix}${suffix}`,
        `Outbox ${suffix}`,
        `hu36-outbox-${suffix.toLowerCase()}`,
      ],
    );
    const user = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name, password_hash)
       VALUES ($1, $2, $3) RETURNING id`,
      [
        `${suffix.toLowerCase()}@hu36-outbox.test`,
        `Outbox ${suffix}`,
        'not-used',
      ],
    );
    const batch = await pool.query<{ id: string }>(
      `INSERT INTO import_batches
         (organization_id, import_profile_id, status_id, uploaded_by_user_id,
          source_file_name, file_hash)
       SELECT $1, profile.id, status.id, $2, $3, $4
       FROM import_profiles AS profile
       CROSS JOIN cat_import_batch_statuses AS status
       WHERE profile.code = 'stock_general'
         AND status.code = 'queued'
       RETURNING id`,
      [
        organization.rows[0].id,
        user.rows[0].id,
        `${suffix}.xlsx`,
        'a'.repeat(64),
      ],
    );
    const outbox = await pool.query<{ id: string }>(
      `INSERT INTO import_job_outbox
         (import_batch_id, event_type, status, payload, available_at,
          locked_at, locked_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        batch.rows[0].id,
        IMPORT_BATCH_QUEUED_EVENT,
        overrides.status ?? 'pending',
        { batchId: batch.rows[0].id },
        new Date('2026-08-27T17:59:00.000Z'),
        overrides.lockedAt ?? null,
        overrides.lockedBy ?? null,
      ],
    );
    return { eventId: outbox.rows[0].id, batchId: batch.rows[0].id };
  }

  async function readEvent(eventId: string) {
    const result = await pool.query<{
      status: string;
      available_at: Date;
      published_at: Date | null;
      locked_by: string | null;
      last_error_code: string | null;
    }>(
      `SELECT status, available_at, published_at, locked_by, last_error_code
       FROM import_job_outbox WHERE id = $1`,
      [eventId],
    );
    return result.rows[0];
  }

  async function cleanup(): Promise<void> {
    await pool.query(
      `DELETE FROM import_job_outbox
       WHERE import_batch_id IN (
         SELECT batch.id
         FROM import_batches AS batch
         JOIN organizations AS organization
           ON organization.id = batch.organization_id
         WHERE organization.code LIKE $1
       )`,
      [`${prefix}%`],
    );
    await pool.query(
      `DELETE FROM import_batches
       WHERE organization_id IN (
         SELECT id FROM organizations WHERE code LIKE $1
       )`,
      [`${prefix}%`],
    );
    await pool.query("DELETE FROM users WHERE email LIKE '%@hu36-outbox.test'");
    await pool.query('DELETE FROM organizations WHERE code LIKE $1', [
      `${prefix}%`,
    ]);
  }
});
