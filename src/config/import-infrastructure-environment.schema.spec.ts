import { describe, expect, it } from 'vitest';
import { parseImportInfrastructureEnvironment } from './import-infrastructure-environment.schema';

const objectStorageEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  OBJECT_STORAGE_ENDPOINT: 'http://object-storage.test:9000',
  OBJECT_STORAGE_REGION: 'mx-test-1',
  OBJECT_STORAGE_BUCKET: 'dirego-scm-test',
  OBJECT_STORAGE_ACCESS_KEY_ID: 'test-access-key',
  OBJECT_STORAGE_SECRET_ACCESS_KEY: 'test-secret-key',
};

const workerEnvironment = (
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv => ({
  ...objectStorageEnvironment,
  SCM_PROCESS_ROLE: 'worker',
  REDIS_URL: 'redis://:test-password@redis-test:6379',
  ...overrides,
});

describe('parseImportInfrastructureEnvironment', () => {
  it('defaults to the API role without requiring Redis', () => {
    expect(
      parseImportInfrastructureEnvironment(objectStorageEnvironment),
    ).toMatchObject({
      SCM_PROCESS_ROLE: 'api',
      OBJECT_STORAGE_KEY_PREFIX: 'imports/',
      OBJECT_STORAGE_FORCE_PATH_STYLE: true,
      OBJECT_STORAGE_REQUEST_TIMEOUT_MS: 30_000,
    });
  });

  it('uses the approved worker defaults', () => {
    expect(
      parseImportInfrastructureEnvironment(workerEnvironment()),
    ).toMatchObject({
      SCM_PROCESS_ROLE: 'worker',
      BULLMQ_PREFIX: 'dirego-scm',
      IMPORT_QUEUE_NAME: 'imports',
      IMPORT_WORKER_CONCURRENCY: 1,
      IMPORT_JOB_ATTEMPTS: 3,
      IMPORT_JOB_BACKOFF_MS: [30_000, 120_000, 300_000],
      IMPORT_WORKER_HEARTBEAT_MS: 15_000,
      IMPORT_WORKER_STALE_AFTER_MS: 90_000,
      IMPORT_OUTBOX_POLL_MS: 1_000,
      IMPORT_OUTBOX_BATCH_SIZE: 20,
      IMPORT_OUTBOX_LOCK_MS: 60_000,
    });
  });

  it('requires Redis only for the worker role', () => {
    expect(() =>
      parseImportInfrastructureEnvironment(
        workerEnvironment({ REDIS_URL: undefined }),
      ),
    ).toThrow('REDIS_URL');
  });

  it('rejects unsupported Redis protocols', () => {
    expect(() =>
      parseImportInfrastructureEnvironment(
        workerEnvironment({ REDIS_URL: 'https://redis.test' }),
      ),
    ).toThrow('must use redis:// or rediss://');
  });

  it('requires remote HTTPS Object Storage in production', () => {
    expect(() =>
      parseImportInfrastructureEnvironment({
        ...objectStorageEnvironment,
        NODE_ENV: 'production',
        OBJECT_STORAGE_ENDPOINT: 'http://127.0.0.1:9000',
      }),
    ).toThrow('OBJECT_STORAGE_ENDPOINT');
  });

  it('requires authenticated remote Redis in production', () => {
    expect(() =>
      parseImportInfrastructureEnvironment(
        workerEnvironment({
          NODE_ENV: 'production',
          OBJECT_STORAGE_ENDPOINT:
            'https://namespace.compat.objectstorage.mx-test-1.oraclecloud.com',
          REDIS_URL: 'redis://redis.internal:6379',
        }),
      ),
    ).toThrow('must include authentication in production');
  });

  it('rejects malformed backoff schedules', () => {
    expect(() =>
      parseImportInfrastructureEnvironment(
        workerEnvironment({ IMPORT_JOB_BACKOFF_MS: '30000,120000' }),
      ),
    ).toThrow('IMPORT_JOB_BACKOFF_MS');
  });

  it('requires the stale threshold to cover three heartbeats', () => {
    expect(() =>
      parseImportInfrastructureEnvironment(
        workerEnvironment({
          IMPORT_WORKER_HEARTBEAT_MS: '30000',
          IMPORT_WORKER_STALE_AFTER_MS: '89999',
        }),
      ),
    ).toThrow('IMPORT_WORKER_STALE_AFTER_MS');
  });

  it('requires the outbox lock to exceed its polling interval', () => {
    expect(() =>
      parseImportInfrastructureEnvironment(
        workerEnvironment({
          IMPORT_OUTBOX_POLL_MS: '5000',
          IMPORT_OUTBOX_LOCK_MS: '5000',
        }),
      ),
    ).toThrow('IMPORT_OUTBOX_LOCK_MS');
  });

  it('keeps the initial worker concurrency at one', () => {
    expect(() =>
      parseImportInfrastructureEnvironment(
        workerEnvironment({ IMPORT_WORKER_CONCURRENCY: '2' }),
      ),
    ).toThrow('IMPORT_WORKER_CONCURRENCY');
  });

  it('does not expose rejected credentials in errors', () => {
    const secret = 'secret-that-must-not-be-logged';

    try {
      parseImportInfrastructureEnvironment(
        workerEnvironment({
          OBJECT_STORAGE_SECRET_ACCESS_KEY: secret,
          REDIS_URL: `redis://:${secret}@localhost:6379`,
          NODE_ENV: 'production',
          OBJECT_STORAGE_ENDPOINT:
            'https://namespace.compat.objectstorage.mx-test-1.oraclecloud.com',
        }),
      );
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});
