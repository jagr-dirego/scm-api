import type { INestApplicationContext, LoggerService } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkerImportInfrastructureModule } from './imports/infrastructure/worker-import-infrastructure.module';
import { bootstrapWorker } from './worker-bootstrap';

vi.hoisted(() => {
  process.env.DATABASE_URL ??=
    'postgresql://scm_test:scm_test_password@127.0.0.1:15433/scm_test';
});

describe('bootstrapWorker', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a worker application context with shutdown hooks', async () => {
    const enableShutdownHooks = vi.fn();
    const application = {
      enableShutdownHooks,
    } as unknown as INestApplicationContext;
    const createApplicationContext = vi
      .spyOn(NestFactory, 'createApplicationContext')
      .mockResolvedValue(application);
    const logger = {} as LoggerService;

    await expect(bootstrapWorker(logger)).resolves.toBe(application);

    expect(createApplicationContext).toHaveBeenCalledWith(
      WorkerImportInfrastructureModule,
      { logger },
    );
    expect(enableShutdownHooks).toHaveBeenCalledOnce();
  });
});
