import { z } from 'zod';
import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import type { TokenOptions } from '../auth/token.constants';

const keyIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._-]+$/);
const booleanEnvironmentSchema = z.preprocess((value) => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}, z.boolean());

const tokenEnvironmentSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    JWT_ISSUER: z.string().url().max(200),
    JWT_AUDIENCE: z.string().min(1).max(200),
    JWT_ACCESS_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(300)
      .max(900)
      .default(600),
    JWT_SIGNING_KEY_ID: keyIdSchema,
    JWT_PRIVATE_KEY_B64: z.string().min(1),
    JWT_PUBLIC_KEYS_JSON: z.string().min(1),
    SESSION_IDLE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(900)
      .max(86_400)
      .default(28_800),
    SESSION_ABSOLUTE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(86_400)
      .max(7_776_000)
      .default(2_592_000),
    REFRESH_COOKIE_NAME: z
      .string()
      .min(1)
      .max(100)
      .default('__Host-dirego_refresh'),
    REFRESH_COOKIE_SECURE: booleanEnvironmentSchema.default(true),
  })
  .superRefine((value, context) => {
    if (value.SESSION_IDLE_TTL_SECONDS >= value.SESSION_ABSOLUTE_TTL_SECONDS) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SESSION_IDLE_TTL_SECONDS'],
        message: 'must be lower than SESSION_ABSOLUTE_TTL_SECONDS',
      });
    }
    if (value.NODE_ENV === 'production' && !value.REFRESH_COOKIE_SECURE) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['REFRESH_COOKIE_SECURE'],
        message: 'must be true in production',
      });
    }
    if (
      value.NODE_ENV === 'production' &&
      value.REFRESH_COOKIE_NAME !== '__Host-dirego_refresh'
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['REFRESH_COOKIE_NAME'],
        message: 'must use the approved __Host- cookie name in production',
      });
    }
  });

const decodePem = (
  encoded: string,
  field: string,
  expectedLabel: 'PRIVATE KEY' | 'PUBLIC KEY',
): string => {
  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    if (
      !decoded.includes(`-----BEGIN ${expectedLabel}-----`) ||
      !decoded.includes(`-----END ${expectedLabel}-----`)
    ) {
      throw new Error('not PEM');
    }
    return decoded;
  } catch {
    throw new Error(`${field}: invalid Base64 PEM`);
  }
};

const validateRsaKey = (key: KeyObject, field: string): void => {
  if (
    key.asymmetricKeyType !== 'rsa' ||
    (key.asymmetricKeyDetails?.modulusLength ?? 0) < 3072
  ) {
    throw new Error(`${field}: must be an RSA key of at least 3072 bits`);
  }
};

const parsePublicKeys = (value: string): Record<string, string> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('JWT_PUBLIC_KEYS_JSON: invalid JSON');
  }

  const result = z.record(keyIdSchema, z.string().min(1)).safeParse(parsed);
  if (!result.success || Object.keys(result.data).length === 0) {
    throw new Error('JWT_PUBLIC_KEYS_JSON: invalid key map');
  }
  return Object.fromEntries(
    Object.entries(result.data).map(([keyId, key]) => [
      keyId,
      decodePem(key, 'JWT_PUBLIC_KEYS_JSON', 'PUBLIC KEY'),
    ]),
  );
};

export function parseTokenEnvironment(
  environment: NodeJS.ProcessEnv,
): TokenOptions {
  const result = tokenEnvironmentSchema.safeParse(environment);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid token configuration: ${issues}`);
  }

  const publicKeysPem = parsePublicKeys(result.data.JWT_PUBLIC_KEYS_JSON);
  if (!publicKeysPem[result.data.JWT_SIGNING_KEY_ID]) {
    throw new Error(
      'JWT_SIGNING_KEY_ID: active key is missing from JWT_PUBLIC_KEYS_JSON',
    );
  }

  const privateKeyPem = decodePem(
    result.data.JWT_PRIVATE_KEY_B64,
    'JWT_PRIVATE_KEY_B64',
    'PRIVATE KEY',
  );
  try {
    validateRsaKey(createPrivateKey(privateKeyPem), 'JWT_PRIVATE_KEY_B64');
    for (const publicKey of Object.values(publicKeysPem)) {
      validateRsaKey(createPublicKey(publicKey), 'JWT_PUBLIC_KEYS_JSON');
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes(': must be an RSA key')
    ) {
      throw error;
    }
    throw new Error('JWT key material: invalid RSA PEM');
  }

  return {
    issuer: result.data.JWT_ISSUER,
    audience: result.data.JWT_AUDIENCE,
    accessTtlSeconds: result.data.JWT_ACCESS_TTL_SECONDS,
    signingKeyId: result.data.JWT_SIGNING_KEY_ID,
    privateKeyPem,
    publicKeysPem,
    sessionIdleTtlSeconds: result.data.SESSION_IDLE_TTL_SECONDS,
    sessionAbsoluteTtlSeconds: result.data.SESSION_ABSOLUTE_TTL_SECONDS,
    refreshCookieName: result.data.REFRESH_COOKIE_NAME,
    refreshCookieSecure: result.data.REFRESH_COOKIE_SECURE,
  };
}
