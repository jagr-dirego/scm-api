import { describe, expect, it } from 'vitest';
import {
  createImportQueueJob,
  IMPORT_BATCH_QUEUED_EVENT,
} from './dispatcher.contracts';
import type { ClaimedImportOutboxEvent } from './ports/import-outbox.repository.port';
import { IMPORT_OUTBOX_REPOSITORY_PORT } from './ports/import-outbox.repository.port';
import { IMPORT_QUEUE_PUBLISHER_PORT } from './ports/import-queue-publisher.port';
import { OBJECT_STORAGE_PORT } from './ports/object-storage.port';

const event = (
  overrides: Partial<ClaimedImportOutboxEvent> = {},
): ClaimedImportOutboxEvent => ({
  id: '019c9c3c-8118-7a25-9136-f58ba13ef409',
  batchId: '019c9c3c-93ae-73cf-8c60-4d8d4f918ca1',
  eventType: IMPORT_BATCH_QUEUED_EVENT,
  attemptCount: 0,
  lockedBy: 'worker-1',
  lockExpiresAt: new Date('2026-08-27T18:00:00.000Z'),
  ...overrides,
});

describe('import dispatcher contracts', () => {
  it('creates a minimal deterministic queue job from an outbox event', () => {
    const job = createImportQueueJob(event());

    expect(job).toEqual({
      jobId: '019c9c3c-93ae-73cf-8c60-4d8d4f918ca1',
      batchId: '019c9c3c-93ae-73cf-8c60-4d8d4f918ca1',
    });
    expect(Object.isFrozen(job)).toBe(true);
    expect(Object.keys(job)).toEqual(['jobId', 'batchId']);
  });

  it('rejects outbox event types outside the approved contract', () => {
    expect(() =>
      createImportQueueJob(event({ eventType: 'import.batch.deleted.v1' })),
    ).toThrow('Unsupported import outbox event type');
  });

  it('keeps infrastructure injection tokens distinct', () => {
    expect(
      new Set([
        OBJECT_STORAGE_PORT,
        IMPORT_QUEUE_PUBLISHER_PORT,
        IMPORT_OUTBOX_REPOSITORY_PORT,
      ]).size,
    ).toBe(3);
  });
});
