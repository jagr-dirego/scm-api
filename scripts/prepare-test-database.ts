import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { assertSafeTestDatabaseUrl } from '../src/database/test-database-safety';

const connectionString = assertSafeTestDatabaseUrl(
  process.env.TEST_DATABASE_URL,
);
const client = new pg.Client({ connectionString });

async function applyMigration(id: string, url: URL): Promise<void> {
  const sql = await readFile(url, 'utf8');

  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('COMMIT');
    console.log(`Migracion aplicada: ${id}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function prepare(): Promise<void> {
  const { databaseMigrations, databaseSeeds } =
    await import('@jagr-dirego/scm-database/artifacts');

  await client.connect();

  const existing = await client.query<{ count: number }>(
    `SELECT count(*)::integer AS count
     FROM pg_tables
     WHERE schemaname = 'public'`,
  );
  if (existing.rows[0]?.count !== 0) {
    throw new Error('La base scm_test debe estar vacia antes de prepararla');
  }

  for (const migration of databaseMigrations) {
    await applyMigration(migration.id, migration.url);
  }

  for (const seed of databaseSeeds) {
    await client.query(await readFile(seed.url, 'utf8'));
    console.log(`Seed aplicado: ${seed.id}`);
  }

  const validation = await client.query<{
    organizations: string | null;
    permissions: number;
    profiles: number;
  }>(
    `SELECT
       to_regclass('public.organizations')::text AS organizations,
       (SELECT count(*)::integer FROM permissions) AS permissions,
       (SELECT count(*)::integer FROM import_profiles) AS profiles`,
  );
  const result = validation.rows[0];
  if (
    result?.organizations !== 'organizations' ||
    result.permissions === 0 ||
    result.profiles === 0
  ) {
    throw new Error('La validacion posterior de scm_test fallo');
  }

  console.log('Base scm_test preparada correctamente');
}

async function main(): Promise<void> {
  try {
    await prepare();
  } finally {
    await client.end().catch(() => undefined);
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Error desconocido');
  process.exitCode = 1;
});
