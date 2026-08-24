import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { createFastifyAdapter } from '../observability/fastify-adapter';
import { configureOpenApi } from './configure-openapi';

describe('configureOpenApi', () => {
  let app: NestFastifyApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  const createApp = async (enabled: boolean) => {
    const module = await Test.createTestingModule({}).compile();
    app = module.createNestApplication<NestFastifyApplication>(
      createFastifyAdapter(),
      { logger: false },
    );
    app.setGlobalPrefix('api/v1');
    configureOpenApi(app, enabled);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    return app;
  };

  it('publishes the versioned document when enabled', async () => {
    const application = await createApp(true);
    const response = await application.inject({
      method: 'GET',
      url: '/api/v1/docs-json',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      info: { title: 'DIREGO SCM API', version: '1.0' },
    });
  });

  it('does not expose the document when disabled', async () => {
    const application = await createApp(false);
    const response = await application.inject({
      method: 'GET',
      url: '/api/v1/docs-json',
    });

    expect(response.statusCode).toBe(404);
  });
});
