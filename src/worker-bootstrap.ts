import type { INestApplicationContext, LoggerService } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerImportInfrastructureModule } from './imports/infrastructure/worker-import-infrastructure.module';

export async function bootstrapWorker(
  logger: LoggerService,
): Promise<INestApplicationContext> {
  const application = await NestFactory.createApplicationContext(
    WorkerImportInfrastructureModule,
    { logger },
  );
  application.enableShutdownHooks();
  return application;
}
