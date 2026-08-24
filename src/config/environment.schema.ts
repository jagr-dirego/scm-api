import { z } from 'zod';

const booleanEnvironmentSchema = z.preprocess((value) => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}, z.boolean());

const environmentSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  OPENAPI_ENABLED: booleanEnvironmentSchema.default(true),
  DATABASE_URL: z.string().url().startsWith('postgresql://'),
  ARGON2_MEMORY_COST: z.coerce
    .number()
    .int()
    .min(19_456)
    .max(262_144)
    .default(65_536),
  ARGON2_TIME_COST: z.coerce.number().int().min(2).max(10).default(3),
  ARGON2_PARALLELISM: z.coerce.number().int().min(1).max(4).default(1),
  ARGON2_HASH_LENGTH: z.coerce.number().int().min(16).max(64).default(32),
  AUTH_MAX_FAILED_ATTEMPTS: z.coerce.number().int().min(3).max(20).default(5),
  AUTH_LOCKOUT_MINUTES: z.coerce.number().int().min(1).max(1_440).default(15),
});

export function parseEnvironment(environment: NodeJS.ProcessEnv) {
  const result = environmentSchema.safeParse(environment);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');

    throw new Error(`Invalid application configuration: ${issues}`);
  }

  return result.data;
}

export type Environment = ReturnType<typeof parseEnvironment>;
