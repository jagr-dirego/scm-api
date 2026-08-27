import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OBJECT_STORAGE_PORT,
  type ObjectStoragePort,
} from '../application/ports/object-storage.port';
import { ImportInfrastructureModule } from './import-infrastructure.module';
import { S3ObjectStorageAdapter } from './object-storage/s3-object-storage.adapter';

const originalEnvironment = { ...process.env };

describe('ImportInfrastructureModule', () => {
  let application: INestApplicationContext | undefined;

  afterEach(async () => {
    await application?.close();
    application = undefined;
    process.env = { ...originalEnvironment };
    vi.restoreAllMocks();
  });

  it('exposes one S3 adapter through ObjectStoragePort and closes it', async () => {
    Object.assign(process.env, objectStorageEnvironment());
    const destroy = vi.spyOn(S3ObjectStorageAdapter.prototype, 'destroy');
    const testingModule = await Test.createTestingModule({
      imports: [ImportInfrastructureModule],
    }).compile();
    application = testingModule;

    const adapter = testingModule.get(S3ObjectStorageAdapter);
    const port = testingModule.get<ObjectStoragePort>(OBJECT_STORAGE_PORT);

    expect(port).toBe(adapter);
    expect(destroy).not.toHaveBeenCalled();

    await application.close();
    application = undefined;

    expect(destroy).toHaveBeenCalledOnce();
  });

  it('rejects invalid infrastructure configuration during bootstrap', async () => {
    Object.assign(process.env, objectStorageEnvironment());
    delete process.env.OBJECT_STORAGE_BUCKET;

    await expect(
      Test.createTestingModule({
        imports: [ImportInfrastructureModule],
      }).compile(),
    ).rejects.toThrow('Invalid import infrastructure configuration');
  });
});

function objectStorageEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    SCM_PROCESS_ROLE: 'api',
    OBJECT_STORAGE_ENDPOINT: 'http://127.0.0.1:19000',
    OBJECT_STORAGE_REGION: 'us-east-1',
    OBJECT_STORAGE_BUCKET: 'dirego-scm-test',
    OBJECT_STORAGE_ACCESS_KEY_ID: 'test-access-key',
    OBJECT_STORAGE_SECRET_ACCESS_KEY: 'test-secret-key',
    OBJECT_STORAGE_KEY_PREFIX: 'imports/',
    OBJECT_STORAGE_FORCE_PATH_STYLE: 'true',
    OBJECT_STORAGE_REQUEST_TIMEOUT_MS: '30000',
  };
}
