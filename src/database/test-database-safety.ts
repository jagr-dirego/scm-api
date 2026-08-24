const LOCAL_TEST_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function assertSafeTestDatabaseUrl(value: string | undefined): string {
  if (!value) {
    throw new Error('TEST_DATABASE_URL es obligatoria');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('TEST_DATABASE_URL no es una URL valida');
  }

  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw new Error('TEST_DATABASE_URL debe usar PostgreSQL');
  }

  if (!LOCAL_TEST_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('La base de pruebas debe usar un host local');
  }

  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (databaseName !== 'scm_test') {
    throw new Error('La base de pruebas debe llamarse scm_test');
  }

  return value;
}
