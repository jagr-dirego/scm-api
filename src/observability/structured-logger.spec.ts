import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { NestStructuredLogger } from './nest-structured-logger';
import { RequestContextService } from './request-context.service';
import { createStructuredLogger, REDACTED_VALUE } from './structured-logger';

const createCapture = (level = 'trace', environment = 'test') => {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk: unknown, _encoding, callback) {
      lines.push(
        typeof chunk === 'string'
          ? chunk
          : Buffer.isBuffer(chunk)
            ? chunk.toString('utf8')
            : '',
      );
      callback();
    },
  });
  return {
    lines,
    logger: createStructuredLogger(level, environment, destination),
  };
};

describe('structured logger', () => {
  it('redacts credentials, cookies, tokens, hashes and database URL', () => {
    const capture = createCapture();
    capture.logger.info(
      {
        authorization: 'Bearer private-access',
        cookie: '__Host-refresh=private-cookie',
        password: 'private-password',
        accessToken: 'private-access-token',
        refreshToken: 'private-refresh-token',
        tokenHash: 'private-token-hash',
        passwordHash: 'private-password-hash',
        privateKey: 'private-key-pem',
        databaseUrl: 'postgresql://private-database',
      },
      'security probe',
    );

    const output = capture.lines.join('');
    expect(output).not.toContain('private-');
    expect(output).toContain(REDACTED_VALUE);
  });

  it('serializes only allowed HTTP request and response fields', () => {
    const capture = createCapture();
    capture.logger.info({
      req: {
        id: 'request-id',
        method: 'POST',
        url: '/api/v1/auth/login?email=private@example.com',
        routeOptions: { url: '/api/v1/auth/login' },
        headers: { authorization: 'Bearer private', cookie: 'private-cookie' },
        body: { password: 'private-password' },
      },
      res: { statusCode: 401, headers: { 'set-cookie': 'private-cookie' } },
      responseTime: 12,
    });

    const record = JSON.parse(capture.lines[0] ?? '{}') as Record<
      string,
      unknown
    >;
    expect(record.req).toEqual({
      requestId: 'request-id',
      method: 'POST',
      route: '/api/v1/auth/login',
      path: '/api/v1/auth/login',
    });
    expect(record.res).toEqual({ statusCode: 401 });
    expect(capture.lines[0]).not.toContain('private-password');
    expect(capture.lines[0]).not.toContain('Bearer private');
    expect(capture.lines[0]).not.toContain('private-cookie');
    expect(capture.lines[0]).not.toContain('private@example.com');
  });

  it('respects the configured minimum log level', () => {
    const capture = createCapture('warn');

    capture.logger.info('ignored');
    capture.logger.warn('included');

    expect(capture.lines).toHaveLength(1);
    expect(capture.lines[0]).toContain('included');
  });

  it('adds requestId to Nest logs and omits production stack', () => {
    const capture = createCapture('trace', 'production');
    const nestLogger = new NestStructuredLogger(capture.logger, 'production');
    const context = new RequestContextService();

    context.run({ requestId: 'request-id' }, () => {
      nestLogger.error(
        { password: 'private-password', reason: 'safe-reason' },
        'private-stack',
        'SecurityService',
      );
    });

    const output = capture.lines[0] ?? '';
    expect(output).toContain('request-id');
    expect(output).toContain('SecurityService');
    expect(output).toContain('safe-reason');
    expect(output).toContain(REDACTED_VALUE);
    expect(output).not.toContain('private-password');
    expect(output).not.toContain('private-stack');
  });
});
