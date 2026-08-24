import { Global, Module } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { appConfig } from '../config/app.config';
import {
  DATABASE_CLIENT,
  DATABASE_POOL,
  DATABASE_SCHEMA,
} from './database.constants';
import { DatabaseService } from './database.service';

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_POOL,
      useFactory: () =>
        new Pool({
          connectionString: appConfig.databaseUrl,
          max: 10,
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 5_000,
        }),
    },
    {
      provide: DATABASE_CLIENT,
      inject: [DATABASE_POOL],
      useFactory: (pool: Pool) => drizzle({ client: pool }),
    },
    {
      provide: DATABASE_SCHEMA,
      useFactory: () => import('@jagr-dirego/scm-database/schema'),
    },
    DatabaseService,
  ],
  exports: [DATABASE_POOL, DATABASE_CLIENT, DATABASE_SCHEMA, DatabaseService],
})
export class DatabaseModule {}
