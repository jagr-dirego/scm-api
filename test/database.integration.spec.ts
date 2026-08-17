import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseService } from '../src/database/database.service';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase('PostgreSQL integration', () => {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const databaseService = new DatabaseService(pool);

  beforeAll(async () => {
    await pool.query('SELECT 1');
  });

  afterAll(async () => {
    await databaseService.onModuleDestroy();
  });

  it('passes the readiness connectivity check', async () => {
    await expect(databaseService.checkConnection()).resolves.toBeUndefined();
  });
});
