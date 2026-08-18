import pino, {
  type DestinationStream,
  type Logger,
  type LoggerOptions,
} from 'pino';

export const REDACTED_VALUE = '[REDACTED]';

export const sensitiveLogPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'authorization',
  'cookie',
  'setCookie',
  'password',
  '*.password',
  'body.password',
  'accessToken',
  '*.accessToken',
  'body.accessToken',
  'refreshToken',
  '*.refreshToken',
  'body.refreshToken',
  'tokenHash',
  '*.tokenHash',
  'passwordHash',
  '*.passwordHash',
  'privateKey',
  '*.privateKey',
  'databaseUrl',
  '*.databaseUrl',
] as const;

const options = (level: string, environment: string): LoggerOptions => ({
  level,
  base: { service: 'scm-api', environment },
  messageKey: 'message',
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [...sensitiveLogPaths],
    censor: REDACTED_VALUE,
  },
  serializers: {
    error: pino.stdSerializers.err,
    req: (request: {
      id?: string;
      method?: string;
      url?: string;
      routeOptions?: { url?: string };
    }) => ({
      requestId: request.id,
      method: request.method,
      route: request.routeOptions?.url,
      path: request.url?.split('?', 1)[0],
    }),
    res: (response: { statusCode?: number }) => ({
      statusCode: response.statusCode,
    }),
  },
});

export const createStructuredLogger = (
  level: string,
  environment: string,
  destination?: DestinationStream,
): Logger => pino(options(level, environment), destination);
