import {
  ExecutionContext,
  UnauthorizedException,
  type CanActivate,
} from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AccessSessionGuard,
  type AuthenticatedRequest,
} from '../auth/access-session.guard';
import { createFastifyAdapter } from '../observability/fastify-adapter';
import { AuthenticatedContextController } from './authenticated-context.controller';
import { AuthenticatedContextService } from './authenticated-context.service';

const identity = {
  userId: '10000000-0000-4000-8000-000000000001',
  organizationId: '10000000-0000-4000-8000-000000000002',
  sessionId: '10000000-0000-4000-8000-000000000003',
  tokenId: '10000000-0000-4000-8000-000000000004',
  issuedAt: 1,
  expiresAt: 2,
};

const authenticatedContext = {
  user: {
    id: identity.userId,
    email: 'operator@dirego.test',
    displayName: 'SCM Operator',
  },
  organization: {
    id: identity.organizationId,
    code: 'DIREGO',
    name: 'DIREGO',
  },
  membership: {
    id: '10000000-0000-4000-8000-000000000005',
    defaultBranch: {
      id: '10000000-0000-4000-8000-000000000006',
      code: 'TAMPICO',
      name: 'Tampico CEDI',
    },
  },
  session: {
    id: identity.sessionId,
    idleExpiresAt: '2026-08-25T01:00:00.000Z',
    absoluteExpiresAt: '2026-09-24T01:00:00.000Z',
  },
  capabilities: ['imports.view', 'imports.upload'],
};

class TestAccessSessionGuard implements CanActivate {
  static allow = true;

  canActivate(context: ExecutionContext): boolean {
    if (!TestAccessSessionGuard.allow) {
      throw new UnauthorizedException({
        statusCode: 401,
        code: 'AUTH_INVALID_ACCESS_TOKEN',
        message: 'Access token no valido',
      });
    }
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.auth = identity;
    return true;
  }
}

describe('authenticated context HTTP', () => {
  let app: NestFastifyApplication | undefined;
  const resolve = vi.fn();

  afterEach(async () => {
    await app?.close();
    app = undefined;
    resolve.mockReset();
    TestAccessSessionGuard.allow = true;
  });

  const createApp = async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthenticatedContextController],
      providers: [
        { provide: AuthenticatedContextService, useValue: { resolve } },
      ],
    })
      .overrideGuard(AccessSessionGuard)
      .useClass(TestAccessSessionGuard)
      .compile();

    app = module.createNestApplication<NestFastifyApplication>(
      createFastifyAdapter(),
      { logger: false },
    );
    app.setGlobalPrefix('api/v1');
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    return app;
  };

  it('returns the public context with no-store cache policy', async () => {
    resolve.mockResolvedValue(authenticatedContext);
    const application = await createApp();
    const response = await application.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual(authenticatedContext);
    expect(resolve).toHaveBeenCalledWith(identity);
  });

  it('returns 401 when the access session guard rejects the request', async () => {
    TestAccessSessionGuard.allow = false;
    const application = await createApp();
    const response = await application.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      code: 'AUTH_INVALID_ACCESS_TOKEN',
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('returns 401 when the context disappears after guard validation', async () => {
    resolve.mockResolvedValue(null);
    const application = await createApp();
    const response = await application.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      code: 'AUTH_INVALID_ACCESS_TOKEN',
    });
  });

  it('returns stable 503 without leaking repository details', async () => {
    resolve.mockRejectedValue(new Error('private PostgreSQL detail'));
    const application = await createApp();
    const response = await application.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      code: 'AUTH_CONTEXT_UNAVAILABLE',
    });
    expect(response.body).not.toContain('PostgreSQL');
  });

  it('publishes bearer auth, responses and no-store header in OpenAPI', async () => {
    const application = await createApp();
    const document = SwaggerModule.createDocument(
      application,
      new DocumentBuilder().addBearerAuth().build(),
    );
    const operation = document.paths['/api/v1/auth/me']?.get;

    expect(operation?.security).toEqual([{ bearer: [] }]);
    expect(operation?.responses).toHaveProperty('200');
    expect(operation?.responses).toHaveProperty('401');
    expect(operation?.responses).toHaveProperty('503');
    expect(operation?.responses?.['200']).toHaveProperty(
      'headers.Cache-Control',
    );
  });
});
