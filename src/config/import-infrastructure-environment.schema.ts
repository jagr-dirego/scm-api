import { z } from 'zod';

const booleanEnvironmentSchema = z.preprocess((value) => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}, z.boolean());

const nameSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);

const backoffSchema = z
  .string()
  .regex(/^\d+,\d+,\d+$/, 'must contain exactly three comma-separated values')
  .default('30000,120000,300000')
  .transform((value) => value.split(',').map(Number))
  .refine(
    (values) => values.every((value) => value >= 1_000 && value <= 900_000),
    'values must be between 1000 and 900000 milliseconds',
  );

const objectStorageShape = {
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  OBJECT_STORAGE_ENDPOINT: z.string().url().max(500),
  OBJECT_STORAGE_REGION: nameSchema,
  OBJECT_STORAGE_BUCKET: z
    .string()
    .min(3)
    .max(63)
    .regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/),
  OBJECT_STORAGE_ACCESS_KEY_ID: z.string().min(1).max(512),
  OBJECT_STORAGE_SECRET_ACCESS_KEY: z.string().min(1).max(1_024),
  OBJECT_STORAGE_KEY_PREFIX: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9][A-Za-z0-9/_-]*\/$/)
    .default('imports/'),
  OBJECT_STORAGE_FORCE_PATH_STYLE: booleanEnvironmentSchema.default(true),
  OBJECT_STORAGE_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(120_000)
    .default(30_000),
};

const apiEnvironmentSchema = z.object({
  SCM_PROCESS_ROLE: z.literal('api'),
  ...objectStorageShape,
});

const workerEnvironmentSchema = z.object({
  SCM_PROCESS_ROLE: z.literal('worker'),
  ...objectStorageShape,
  REDIS_URL: z
    .string()
    .url()
    .max(500)
    .refine(
      (value) => ['redis:', 'rediss:'].includes(new URL(value).protocol),
      {
        message: 'must use redis:// or rediss://',
      },
    ),
  BULLMQ_PREFIX: nameSchema.default('dirego-scm'),
  IMPORT_QUEUE_NAME: nameSchema.default('imports'),
  IMPORT_WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(1).default(1),
  IMPORT_JOB_ATTEMPTS: z.coerce.number().int().min(3).max(3).default(3),
  IMPORT_JOB_BACKOFF_MS: backoffSchema,
  IMPORT_WORKER_HEARTBEAT_MS: z.coerce
    .number()
    .int()
    .min(5_000)
    .max(60_000)
    .default(15_000),
  IMPORT_WORKER_STALE_AFTER_MS: z.coerce
    .number()
    .int()
    .min(15_000)
    .max(600_000)
    .default(90_000),
  IMPORT_OUTBOX_POLL_MS: z.coerce
    .number()
    .int()
    .min(250)
    .max(30_000)
    .default(1_000),
  IMPORT_OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
  IMPORT_OUTBOX_LOCK_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(300_000)
    .default(60_000),
});

const importInfrastructureEnvironmentSchema = z
  .discriminatedUnion('SCM_PROCESS_ROLE', [
    apiEnvironmentSchema,
    workerEnvironmentSchema,
  ])
  .superRefine((value, context) => {
    const storageUrl = new URL(value.OBJECT_STORAGE_ENDPOINT);
    if (value.NODE_ENV === 'production' && storageUrl.protocol !== 'https:') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OBJECT_STORAGE_ENDPOINT'],
        message: 'must use HTTPS in production',
      });
    }
    if (
      value.NODE_ENV === 'production' &&
      isLocalHostname(storageUrl.hostname)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OBJECT_STORAGE_ENDPOINT'],
        message: 'must not use a local endpoint in production',
      });
    }
    if (value.SCM_PROCESS_ROLE !== 'worker') return;

    const redisUrl = new URL(value.REDIS_URL);
    if (value.NODE_ENV === 'production' && !redisUrl.password) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['REDIS_URL'],
        message: 'must include authentication in production',
      });
    }
    if (value.NODE_ENV === 'production' && isLocalHostname(redisUrl.hostname)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['REDIS_URL'],
        message: 'must not use a local endpoint in production',
      });
    }
    if (
      value.IMPORT_WORKER_STALE_AFTER_MS <
      value.IMPORT_WORKER_HEARTBEAT_MS * 3
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['IMPORT_WORKER_STALE_AFTER_MS'],
        message: 'must be at least three heartbeat intervals',
      });
    }
    if (value.IMPORT_OUTBOX_LOCK_MS <= value.IMPORT_OUTBOX_POLL_MS) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['IMPORT_OUTBOX_LOCK_MS'],
        message: 'must be greater than IMPORT_OUTBOX_POLL_MS',
      });
    }
  });

function isLocalHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname === '0.0.0.0' ||
    hostname.startsWith('127.') ||
    hostname.endsWith('.localhost')
  );
}

export function parseImportInfrastructureEnvironment(
  environment: NodeJS.ProcessEnv,
) {
  const result = importInfrastructureEnvironmentSchema.safeParse({
    ...environment,
    SCM_PROCESS_ROLE: environment.SCM_PROCESS_ROLE ?? 'api',
  });

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid import infrastructure configuration: ${issues}`);
  }

  return result.data;
}

export type ImportInfrastructureEnvironment = ReturnType<
  typeof parseImportInfrastructureEnvironment
>;
