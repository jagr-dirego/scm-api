import type { ClaimedImportOutboxEvent } from './ports/import-outbox.repository.port';

export const IMPORT_BATCH_QUEUED_EVENT = 'import.batch.queued.v1';

export type ImportQueueJob = Readonly<{
  jobId: string;
  batchId: string;
}>;

export function createImportQueueJob(
  event: ClaimedImportOutboxEvent,
): ImportQueueJob {
  if (event.eventType !== IMPORT_BATCH_QUEUED_EVENT) {
    throw new Error('Unsupported import outbox event type');
  }

  return Object.freeze({
    jobId: event.batchId,
    batchId: event.batchId,
  });
}
