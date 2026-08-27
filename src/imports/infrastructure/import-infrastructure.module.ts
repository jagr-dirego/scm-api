import { Inject, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import {
  type ImportInfrastructureEnvironment,
  parseImportInfrastructureEnvironment,
} from '../../config/import-infrastructure-environment.schema';
import { OBJECT_STORAGE_PORT } from '../application/ports/object-storage.port';
import { S3ObjectStorageAdapter } from './object-storage/s3-object-storage.adapter';

const IMPORT_INFRASTRUCTURE_ENVIRONMENT = Symbol(
  'IMPORT_INFRASTRUCTURE_ENVIRONMENT',
);

@Injectable()
class ObjectStorageLifecycle implements OnModuleDestroy {
  constructor(
    @Inject(S3ObjectStorageAdapter)
    private readonly adapter: S3ObjectStorageAdapter,
  ) {}

  onModuleDestroy(): void {
    this.adapter.destroy();
  }
}

@Module({
  providers: [
    {
      provide: IMPORT_INFRASTRUCTURE_ENVIRONMENT,
      useFactory: () => parseImportInfrastructureEnvironment(process.env),
    },
    {
      provide: S3ObjectStorageAdapter,
      inject: [IMPORT_INFRASTRUCTURE_ENVIRONMENT],
      useFactory: (environment: ImportInfrastructureEnvironment) =>
        new S3ObjectStorageAdapter({
          endpoint: environment.OBJECT_STORAGE_ENDPOINT,
          region: environment.OBJECT_STORAGE_REGION,
          bucket: environment.OBJECT_STORAGE_BUCKET,
          accessKeyId: environment.OBJECT_STORAGE_ACCESS_KEY_ID,
          secretAccessKey: environment.OBJECT_STORAGE_SECRET_ACCESS_KEY,
          keyPrefix: environment.OBJECT_STORAGE_KEY_PREFIX,
          forcePathStyle: environment.OBJECT_STORAGE_FORCE_PATH_STYLE,
          requestTimeoutMs: environment.OBJECT_STORAGE_REQUEST_TIMEOUT_MS,
        }),
    },
    {
      provide: OBJECT_STORAGE_PORT,
      useExisting: S3ObjectStorageAdapter,
    },
    ObjectStorageLifecycle,
  ],
  exports: [OBJECT_STORAGE_PORT],
})
export class ImportInfrastructureModule {}
