import { Inject, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  type ImportInfrastructureEnvironment,
  parseImportInfrastructureEnvironment,
} from '../../config/import-infrastructure-environment.schema';
import { DatabaseModule } from '../../database/database.module';
import { ImportOutboxDispatcherRunner } from '../application/import-outbox-dispatcher.runner';
import { ImportOutboxDispatcherService } from '../application/import-outbox-dispatcher.service';
import { IMPORT_QUEUE_PUBLISHER_PORT } from '../application/ports/import-queue-publisher.port';
import { IMPORT_OUTBOX_REPOSITORY_PORT } from '../application/ports/import-outbox.repository.port';
import { ImportInfrastructureModule } from './import-infrastructure.module';
import { PostgresImportOutboxRepository } from './outbox/postgres-import-outbox.repository';
import { BullMqImportQueuePublisherAdapter } from './queue/bullmq-import-queue-publisher.adapter';

const WORKER_IMPORT_INFRASTRUCTURE_ENVIRONMENT = Symbol(
  'WORKER_IMPORT_INFRASTRUCTURE_ENVIRONMENT',
);
const IMPORT_WORKER_INSTANCE_ID = Symbol('IMPORT_WORKER_INSTANCE_ID');

type WorkerImportInfrastructureEnvironment = Extract<
  ImportInfrastructureEnvironment,
  { SCM_PROCESS_ROLE: 'worker' }
>;

@Injectable()
class ImportQueueLifecycle implements OnModuleDestroy {
  constructor(
    @Inject(BullMqImportQueuePublisherAdapter)
    private readonly publisher: BullMqImportQueuePublisherAdapter,
    @Inject(ImportOutboxDispatcherRunner)
    private readonly dispatcherRunner: ImportOutboxDispatcherRunner,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.dispatcherRunner.stop();
    await this.publisher.close();
  }
}

@Module({
  imports: [DatabaseModule, ImportInfrastructureModule],
  providers: [
    {
      provide: WORKER_IMPORT_INFRASTRUCTURE_ENVIRONMENT,
      useFactory: (): WorkerImportInfrastructureEnvironment => {
        const environment = parseImportInfrastructureEnvironment(process.env);
        if (environment.SCM_PROCESS_ROLE !== 'worker') {
          throw new Error(
            'Worker import infrastructure requires SCM_PROCESS_ROLE=worker',
          );
        }
        return environment;
      },
    },
    {
      provide: BullMqImportQueuePublisherAdapter,
      inject: [WORKER_IMPORT_INFRASTRUCTURE_ENVIRONMENT],
      useFactory: (environment: WorkerImportInfrastructureEnvironment) =>
        new BullMqImportQueuePublisherAdapter({
          redisUrl: environment.REDIS_URL,
          queueName: environment.IMPORT_QUEUE_NAME,
          prefix: environment.BULLMQ_PREFIX,
          attempts: environment.IMPORT_JOB_ATTEMPTS,
        }),
    },
    {
      provide: IMPORT_QUEUE_PUBLISHER_PORT,
      useExisting: BullMqImportQueuePublisherAdapter,
    },
    PostgresImportOutboxRepository,
    {
      provide: IMPORT_OUTBOX_REPOSITORY_PORT,
      useExisting: PostgresImportOutboxRepository,
    },
    {
      provide: IMPORT_WORKER_INSTANCE_ID,
      useFactory: () => `worker-${randomUUID()}`,
    },
    {
      provide: ImportOutboxDispatcherService,
      inject: [
        IMPORT_OUTBOX_REPOSITORY_PORT,
        IMPORT_QUEUE_PUBLISHER_PORT,
        WORKER_IMPORT_INFRASTRUCTURE_ENVIRONMENT,
        IMPORT_WORKER_INSTANCE_ID,
      ],
      useFactory: (
        repository: InstanceType<typeof PostgresImportOutboxRepository>,
        publisher: InstanceType<typeof BullMqImportQueuePublisherAdapter>,
        environment: WorkerImportInfrastructureEnvironment,
        workerId: string,
      ) =>
        new ImportOutboxDispatcherService(
          repository,
          publisher,
          {
            workerId,
            lockMs: environment.IMPORT_OUTBOX_LOCK_MS,
            batchSize: environment.IMPORT_OUTBOX_BATCH_SIZE,
            backoffMs: environment.IMPORT_JOB_BACKOFF_MS,
          },
          { now: () => new Date() },
        ),
    },
    {
      provide: ImportOutboxDispatcherRunner,
      inject: [
        ImportOutboxDispatcherService,
        WORKER_IMPORT_INFRASTRUCTURE_ENVIRONMENT,
      ],
      useFactory: (
        dispatcher: ImportOutboxDispatcherService,
        environment: WorkerImportInfrastructureEnvironment,
      ) =>
        new ImportOutboxDispatcherRunner(
          dispatcher,
          environment.IMPORT_OUTBOX_POLL_MS,
        ),
    },
    ImportQueueLifecycle,
  ],
  exports: [
    ImportInfrastructureModule,
    IMPORT_QUEUE_PUBLISHER_PORT,
    IMPORT_OUTBOX_REPOSITORY_PORT,
    ImportOutboxDispatcherService,
    ImportOutboxDispatcherRunner,
  ],
})
export class WorkerImportInfrastructureModule {}
