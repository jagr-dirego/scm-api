import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImportOutboxDispatcherService } from '../application/import-outbox-dispatcher.service';
import {
  IMPORT_QUEUE_PUBLISHER_PORT,
  type ImportQueuePublisherPort,
} from '../application/ports/import-queue-publisher.port';
import {
  IMPORT_OUTBOX_REPOSITORY_PORT,
  type ImportOutboxRepository,
} from '../application/ports/import-outbox.repository.port';
import { PostgresImportOutboxRepository } from './outbox/postgres-import-outbox.repository';
import { BullMqImportQueuePublisherAdapter } from './queue/bullmq-import-queue-publisher.adapter';
import { WorkerImportInfrastructureModule } from './worker-import-infrastructure.module';

vi.hoisted(() => {
  process.env.DATABASE_URL ??=
    'postgresql://scm_test:scm_test_password@127.0.0.1:15433/scm_test';
});

const originalEnvironment = { ...process.env };

describe('WorkerImportInfrastructureModule', () => {
  let application: INestApplicationContext | undefined;

  afterEach(async () => {
    await application?.close();
    application = undefined;
    process.env = { ...originalEnvironment };
    vi.restoreAllMocks();
  });

  it('exposes one BullMQ publisher and closes it for worker role', async () => {
    Object.assign(process.env, workerEnvironment());
    const publisher = {
      publish: vi.fn<ImportQueuePublisherPort['publish']>(),
      close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    };
    const repository = {
      claimPending: vi.fn<ImportOutboxRepository['claimPending']>(),
      markPublished: vi.fn<ImportOutboxRepository['markPublished']>(),
      reschedule: vi.fn<ImportOutboxRepository['reschedule']>(),
    };
    const testingModule = await Test.createTestingModule({
      imports: [WorkerImportInfrastructureModule],
    })
      .overrideProvider(BullMqImportQueuePublisherAdapter)
      .useValue(publisher)
      .overrideProvider(PostgresImportOutboxRepository)
      .useValue(repository)
      .compile();
    application = testingModule;

    expect(
      testingModule.get<ImportQueuePublisherPort>(IMPORT_QUEUE_PUBLISHER_PORT),
    ).toBe(publisher);
    expect(
      testingModule.get<ImportOutboxRepository>(IMPORT_OUTBOX_REPOSITORY_PORT),
    ).toBe(repository);
    expect(testingModule.get(ImportOutboxDispatcherService)).toBeInstanceOf(
      ImportOutboxDispatcherService,
    );
    expect(repository.claimPending).not.toHaveBeenCalled();
    expect(publisher.publish).not.toHaveBeenCalled();

    await application.close();
    application = undefined;

    expect(publisher.close).toHaveBeenCalledOnce();
  });

  it('rejects registration for api role', async () => {
    Object.assign(process.env, workerEnvironment(), {
      SCM_PROCESS_ROLE: 'api',
    });

    await expect(
      Test.createTestingModule({
        imports: [WorkerImportInfrastructureModule],
      })
        .overrideProvider(BullMqImportQueuePublisherAdapter)
        .useValue({ publish: vi.fn(), close: vi.fn() })
        .overrideProvider(PostgresImportOutboxRepository)
        .useValue({
          claimPending: vi.fn(),
          markPublished: vi.fn(),
          reschedule: vi.fn(),
        })
        .compile(),
    ).rejects.toThrow(
      'Worker import infrastructure requires SCM_PROCESS_ROLE=worker',
    );
  });
});

function workerEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    SCM_PROCESS_ROLE: 'worker',
    OBJECT_STORAGE_ENDPOINT: 'http://127.0.0.1:19000',
    OBJECT_STORAGE_REGION: 'us-east-1',
    OBJECT_STORAGE_BUCKET: 'dirego-scm-test',
    OBJECT_STORAGE_ACCESS_KEY_ID: 'test-access-key',
    OBJECT_STORAGE_SECRET_ACCESS_KEY: 'test-secret-key',
    OBJECT_STORAGE_KEY_PREFIX: 'imports/',
    OBJECT_STORAGE_FORCE_PATH_STYLE: 'true',
    OBJECT_STORAGE_REQUEST_TIMEOUT_MS: '30000',
    REDIS_URL: 'redis://:test-password@127.0.0.1:16379',
    BULLMQ_PREFIX: 'dirego-scm-test',
    IMPORT_QUEUE_NAME: 'imports-test',
    IMPORT_WORKER_CONCURRENCY: '1',
    IMPORT_JOB_ATTEMPTS: '3',
    IMPORT_JOB_BACKOFF_MS: '30000,120000,300000',
    IMPORT_WORKER_HEARTBEAT_MS: '15000',
    IMPORT_WORKER_STALE_AFTER_MS: '90000',
    IMPORT_OUTBOX_POLL_MS: '1000',
    IMPORT_OUTBOX_BATCH_SIZE: '20',
    IMPORT_OUTBOX_LOCK_MS: '60000',
  };
}
