import { parseEnvironment } from './environment.schema';

const environment = parseEnvironment(process.env);

export const appConfig = {
  nodeEnv: environment.NODE_ENV,
  port: environment.PORT,
  logLevel: environment.LOG_LEVEL,
  openApiEnabled: environment.OPENAPI_ENABLED,
  databaseUrl: environment.DATABASE_URL,
  argon2: {
    memoryCost: environment.ARGON2_MEMORY_COST,
    timeCost: environment.ARGON2_TIME_COST,
    parallelism: environment.ARGON2_PARALLELISM,
    hashLength: environment.ARGON2_HASH_LENGTH,
  },
  auth: {
    maxFailedAttempts: environment.AUTH_MAX_FAILED_ATTEMPTS,
    lockoutMinutes: environment.AUTH_LOCKOUT_MINUTES,
  },
  corsOrigins: environment.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
};
