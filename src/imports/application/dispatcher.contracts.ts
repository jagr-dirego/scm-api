import type { ClaimedImportOutboxEvent } from './ports/import-outbox.repository.port';

export const IMPORT_BATCH_QUEUED_EVENT = 'import.batch.queued.v1';

export type ImportQueueJob = Readonly<{
  jobId: string;
  batchId: string;
}>;

export class UnsupportedImportOutboxEventError extends Error {
  constructor() {
    super('Unsupported import outbox event type');
    this.name = 'UnsupportedImportOutboxEventError';
  }
}

export function createImportQueueJob(
  event: ClaimedImportOutboxEvent,
): ImportQueueJob {
  if (event.eventType !== IMPORT_BATCH_QUEUED_EVENT) {
    throw new UnsupportedImportOutboxEventError();
  }

  return Object.freeze({
    jobId: event.batchId,
    batchId: event.batchId,
  });
}
