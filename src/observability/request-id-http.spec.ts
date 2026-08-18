import { Controller, ForbiddenException, Get, Inject } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createFastifyAdapter } from './fastify-adapter';
import { ObservabilityModule } from './observability.module';
import { RequestContextService } from './request-context.service';
import { isRequestId } from './request-id';

@Controller('probe')
class RequestIdProbeController {
  constructor(
    @Inject(RequestContextService)
    private readonly context: RequestContextService,
  ) {}

  @Get()
  readContext() {
    return { requestId: this.context.getRequestId() };
  }

  @Get('failure')
  fail() {
    throw new Error('private SQL and password detail');
  }

  @Get('denied')
  deny() {
    throw new ForbiddenException({
      statusCode: 403,
      code: 'PROBE_DENIED',
      message: 'Acceso denegado',
      privateDetail: 'must-not-leak',
    });
  }
}

describe('request id HTTP integration', () => {
  let app: NestFastifyApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  const createApp = async () => {
    const module = await Test.createTestingModule({
      imports: [ObservabilityModule],
      controllers: [RequestIdProbeController],
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(
      createFastifyAdapter(),
      { logger: false },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    return app;
  };

  it('propagates a valid client UUID to response and request context', async () => {
    const application = await createApp();
    const requestId = '10000000-0000-4000-8000-000000000001';
    const response = await application.inject({
      method: 'GET',
      url: '/probe',
      headers: { 'x-request-id': requestId },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-request-id']).toBe(requestId);
    expect(response.json()).toEqual({ requestId });
  });

  it('replaces an untrusted client value consistently', async () => {
    const application = await createApp();
    const response = await application.inject({
      method: 'GET',
      url: '/probe',
      headers: { 'x-request-id': 'attacker-controlled-value' },
    });
    const responseId = response.headers['x-request-id'];

    expect(isRequestId(responseId)).toBe(true);
    expect(responseId).not.toBe('attacker-controlled-value');
    expect(response.json()).toEqual({ requestId: responseId });
  });

  it('returns a stable generic contract for unexpected errors', async () => {
    const application = await createApp();
    const response = await application.inject({
      method: 'GET',
      url: '/probe/failure',
    });
    const requestId = response.headers['x-request-id'];

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      statusCode: 500,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Ocurrio un error interno',
      requestId,
    });
    expect(response.body).not.toContain('private');
    expect(response.body).not.toContain('password');
    expect(response.body).not.toContain('SQL');
  });

  it('preserves only the public fields of expected errors', async () => {
    const application = await createApp();
    const response = await application.inject({
      method: 'GET',
      url: '/probe/denied',
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      statusCode: 403,
      code: 'PROBE_DENIED',
      message: 'Acceso denegado',
      requestId: response.headers['x-request-id'],
    });
    expect(response.body).not.toContain('must-not-leak');
  });
});
