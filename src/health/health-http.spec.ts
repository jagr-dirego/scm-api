import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseService } from '../database/database.service';
import { createFastifyAdapter } from '../observability/fastify-adapter';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('health HTTP', () => {
  let app: NestFastifyApplication | undefined;
  const checkConnection = vi.fn();

  afterEach(async () => {
    await app?.close();
    app = undefined;
    checkConnection.mockReset();
  });

  const createApp = async () => {
    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        HealthService,
        { provide: DatabaseService, useValue: { checkConnection } },
      ],
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(
      createFastifyAdapter(),
      { logger: false },
    );
    app.setGlobalPrefix('api/v1');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    return app;
  };

  it('reports liveness without querying PostgreSQL', async () => {
    const application = await createApp();
    const response = await application.inject({
      method: 'GET',
      url: '/api/v1/health/live',
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', service: 'scm-api' });
    expect(checkConnection).not.toHaveBeenCalled();
  });

  it('reports readiness when PostgreSQL is available', async () => {
    checkConnection.mockResolvedValue(undefined);
    const application = await createApp();
    const response = await application.inject({
      method: 'GET',
      url: '/api/v1/health/ready',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      service: 'scm-api',
      checks: { database: 'available' },
    });
  });

  it('reports unavailability without leaking database details', async () => {
    checkConnection.mockRejectedValue(
      new Error('postgres://private-user:private-password@secret-host'),
    );
    const application = await createApp();
    const response = await application.inject({
      method: 'GET',
      url: '/api/v1/health/ready',
    });

    expect(response.statusCode).toBe(503);
    expect(response.body).toContain('unavailable');
    expect(response.body).not.toContain('private-password');
    expect(response.body).not.toContain('secret-host');
  });
});
