import {
  createImportQueueJob,
  UnsupportedImportOutboxEventError,
} from './dispatcher.contracts';
import type { ImportOutboxRepository } from './ports/import-outbox.repository.port';
import type { ImportQueuePublisherPort } from './ports/import-queue-publisher.port';

export type ImportOutboxDispatcherOptions = Readonly<{
  workerId: string;
  lockMs: number;
  batchSize: number;
  backoffMs: readonly number[];
}>;

export type ImportOutboxDispatchResult = Readonly<{
  claimed: number;
  published: number;
  rescheduled: number;
  failed: number;
}>;

export type ImportOutboxDispatcherClock = Readonly<{
  now(): Date;
}>;

export class ImportOutboxDispatcherService {
  constructor(
    private readonly repository: ImportOutboxRepository,
    private readonly publisher: ImportQueuePublisherPort,
    private readonly options: ImportOutboxDispatcherOptions,
    private readonly clock: ImportOutboxDispatcherClock,
  ) {
    if (!options.workerId.trim()) {
      throw new Error('Import outbox dispatcher workerId must not be empty');
    }
    if (options.lockMs <= 0 || options.batchSize <= 0) {
      throw new Error('Import outbox dispatcher limits must be positive');
    }
    if (
      options.backoffMs.length === 0 ||
      options.backoffMs.some((ms) => ms <= 0)
    ) {
      throw new Error('Import outbox dispatcher backoff must be positive');
    }
  }

  async dispatchOnce(): Promise<ImportOutboxDispatchResult> {
    const now = this.clock.now();
    const events = await this.repository.claimPending({
      workerId: this.options.workerId,
      now,
      lockExpiresAt: new Date(now.getTime() + this.options.lockMs),
      limit: this.options.batchSize,
    });
    const result = {
      claimed: events.length,
      published: 0,
      rescheduled: 0,
      failed: 0,
    };

    for (const event of events) {
      let errorCode: string | undefined;

      try {
        const job = createImportQueueJob(event);
        await this.publisher.publish(job);
      } catch (error) {
        errorCode =
          error instanceof UnsupportedImportOutboxEventError
            ? 'OUTBOX_EVENT_UNSUPPORTED'
            : 'QUEUE_PUBLISH_FAILED';
      }

      if (!errorCode) {
        try {
          await this.repository.markPublished(
            event.id,
            this.options.workerId,
            this.clock.now(),
          );
          result.published += 1;
          continue;
        } catch {
          errorCode = 'OUTBOX_CONFIRM_FAILED';
        }
      }

      try {
        const failedAt = this.clock.now();
        await this.repository.reschedule({
          eventId: event.id,
          workerId: this.options.workerId,
          availableAt: new Date(
            failedAt.getTime() + this.backoffFor(event.attemptCount),
          ),
          errorCode,
        });
        result.rescheduled += 1;
      } catch {
        result.failed += 1;
      }
    }

    return Object.freeze(result);
  }

  private backoffFor(attemptCount: number): number {
    const index = Math.min(
      Math.max(attemptCount - 1, 0),
      this.options.backoffMs.length - 1,
    );
    return this.options.backoffMs[index];
  }
}
