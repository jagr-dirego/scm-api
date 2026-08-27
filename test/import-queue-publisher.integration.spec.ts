import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import { IMPORT_BATCH_QUEUED_EVENT } from '../src/imports/application/dispatcher.contracts';
import {
  BullMqImportQueuePublisherAdapter,
  IMPORT_JOB_BACKOFF_STRATEGY,
} from '../src/imports/infrastructure/queue/bullmq-import-queue-publisher.adapter';

const redisUrl = process.env.TEST_REDIS_URL;
const describeWithRedis = redisUrl ? describe : describe.skip;
type ImportQueuePayload = Readonly<{ batchId: string }>;

describeWithRedis('BullMqImportQueuePublisherAdapter integration', () => {
  const suffix = randomUUID();
  const queueName = `imports-${suffix}`;
  const prefix = `dirego-scm-test-${suffix}`;
  const connection = new Redis(redisUrl!, { maxRetriesPerRequest: 1 });
  const observer = new Queue<
    ImportQueuePayload,
    void,
    typeof IMPORT_BATCH_QUEUED_EVENT
  >(queueName, { connection, prefix });
  const adapter = new BullMqImportQueuePublisherAdapter({
    redisUrl: redisUrl!,
    queueName,
    prefix,
    attempts: 3,
  });

  afterAll(async () => {
    await observer.obliterate({ force: true });
    await observer.close();
    await connection.quit();
    await adapter.close();
  });

  it('publishes only batchId with deterministic retry options', async () => {
    const batchId = randomUUID();

    await adapter.publish({ jobId: batchId, batchId });

    const queuedJob = await observer.getJob(batchId);
    expect(queuedJob).not.toBeUndefined();
    expect(queuedJob?.name).toBe(IMPORT_BATCH_QUEUED_EVENT);
    expect(queuedJob?.data).toEqual({ batchId });
    expect(Object.keys(queuedJob?.data ?? {})).toEqual(['batchId']);
    expect(queuedJob?.opts).toMatchObject({
      jobId: batchId,
      attempts: 3,
      backoff: { type: IMPORT_JOB_BACKOFF_STRATEGY },
    });
  });

  it('does not create a second job for the same batch', async () => {
    const batchId = randomUUID();

    await adapter.publish({ jobId: batchId, batchId });
    await adapter.publish({ jobId: batchId, batchId });

    const jobs = await observer.getJobs(['waiting', 'delayed']);
    expect(jobs.filter((job) => job.id === batchId)).toHaveLength(1);
  });

  it('rejects a non-deterministic jobId before publishing', async () => {
    await expect(
      adapter.publish({ jobId: randomUUID(), batchId: randomUUID() }),
    ).rejects.toThrow('Import queue jobId must match batchId');
  });
});
