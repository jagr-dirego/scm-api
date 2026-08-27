export const IMPORT_OUTBOX_REPOSITORY_PORT = Symbol(
  'IMPORT_OUTBOX_REPOSITORY_PORT',
);

export type ClaimedImportOutboxEvent = Readonly<{
  id: string;
  batchId: string;
  eventType: string;
  attemptCount: number;
  lockedBy: string;
  lockExpiresAt: Date;
}>;

export type ClaimImportOutboxEventsRequest = Readonly<{
  workerId: string;
  now: Date;
  lockExpiresAt: Date;
  limit: number;
}>;

export type RescheduleImportOutboxEventRequest = Readonly<{
  eventId: string;
  workerId: string;
  availableAt: Date;
  errorCode: string;
}>;

export interface ImportOutboxRepository {
  claimPending(
    request: ClaimImportOutboxEventsRequest,
  ): Promise<readonly ClaimedImportOutboxEvent[]>;
  markPublished(
    eventId: string,
    workerId: string,
    publishedAt: Date,
  ): Promise<void>;
  reschedule(request: RescheduleImportOutboxEventRequest): Promise<void>;
}
