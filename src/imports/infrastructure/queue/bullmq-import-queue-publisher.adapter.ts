import { Queue } from 'bullmq';
import Redis from 'ioredis';
import {
  IMPORT_BATCH_QUEUED_EVENT,
  type ImportQueueJob,
} from '../../application/dispatcher.contracts';
import type { ImportQueuePublisherPort } from '../../application/ports/import-queue-publisher.port';

export const IMPORT_JOB_BACKOFF_STRATEGY = 'import-approved-backoff';

type ImportQueuePayload = Readonly<{
  batchId: string;
}>;

export type BullMqImportQueuePublisherOptions = Readonly<{
  redisUrl: string;
  queueName: string;
  prefix: string;
  attempts: number;
}>;

export class BullMqImportQueuePublisherAdapter implements ImportQueuePublisherPort {
  private readonly connection: Redis;
  private readonly queue: Queue<
    ImportQueuePayload,
    void,
    typeof IMPORT_BATCH_QUEUED_EVENT
  >;

  constructor(private readonly options: BullMqImportQueuePublisherOptions) {
    this.connection = new Redis(options.redisUrl, {
      connectTimeout: 10_000,
      commandTimeout: 10_000,
      maxRetriesPerRequest: 1,
    });
    this.queue = new Queue(options.queueName, {
      connection: this.connection,
      prefix: options.prefix,
    });
  }

  async publish(job: ImportQueueJob): Promise<void> {
    if (job.jobId !== job.batchId) {
      throw new Error('Import queue jobId must match batchId');
    }

    await this.queue.add(
      IMPORT_BATCH_QUEUED_EVENT,
      { batchId: job.batchId },
      {
        jobId: job.jobId,
        attempts: this.options.attempts,
        backoff: { type: IMPORT_JOB_BACKOFF_STRATEGY },
      },
    );
  }

  async close(): Promise<void> {
    await this.queue.close();
    await this.connection.quit();
  }
}
