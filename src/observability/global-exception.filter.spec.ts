import {
  BadRequestException,
  ForbiddenException,
  Logger,
  ServiceUnavailableException,
  type ArgumentsHost,
} from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalExceptionFilter } from './global-exception.filter';
import type { RequestContextService } from './request-context.service';

const requestId = '10000000-0000-4000-8000-000000000001';

const createFixture = () => {
  const reply = {
    header: vi.fn(),
    status: vi.fn(),
    send: vi.fn(),
  };
  reply.header.mockReturnValue(reply);
  reply.status.mockReturnValue(reply);
  const request = {
    id: requestId,
    method: 'GET',
    url: '/private?secret=value',
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => reply,
    }),
  } as ArgumentsHost;
  const context = { getRequestId: vi.fn().mockReturnValue(requestId) };
  return {
    context,
    filter: new GlobalExceptionFilter(
      context as unknown as RequestContextService,
    ),
    host,
    reply,
  };
};

describe('GlobalExceptionFilter', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('preserves the stable public contract of an expected exception', () => {
    const fixture = createFixture();
    fixture.filter.catch(
      new ForbiddenException({
        statusCode: 403,
        code: 'AUTHORIZATION_DENIED',
        message: 'Acceso denegado',
        privateDetail: 'must-not-leak',
      }),
      fixture.host,
    );

    expect(fixture.reply.send).toHaveBeenCalledWith({
      statusCode: 403,
      code: 'AUTHORIZATION_DENIED',
      message: 'Acceso denegado',
      requestId,
    });
  });

  it('normalizes validation arrays without returning field internals', () => {
    const fixture = createFixture();
    fixture.filter.catch(
      new BadRequestException(['private validation detail']),
      fixture.host,
    );

    expect(fixture.reply.send).toHaveBeenCalledWith({
      statusCode: 400,
      code: 'BAD_REQUEST',
      message: 'Solicitud invalida',
      requestId,
    });
  });

  it('hides details from an unexpected error', () => {
    const fixture = createFixture();
    fixture.filter.catch(
      new Error('password=private SQL constraint detail'),
      fixture.host,
    );

    const response = fixture.reply.send.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(response).toEqual({
      statusCode: 500,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Ocurrio un error interno',
      requestId,
    });
    expect(JSON.stringify(response)).not.toContain('private');
    expect(JSON.stringify(response)).not.toContain('constraint');
  });

  it('keeps 503 status but hides an untrusted exception message', () => {
    const fixture = createFixture();
    fixture.filter.catch(
      new ServiceUnavailableException('private upstream detail'),
      fixture.host,
    );

    expect(fixture.reply.send).toHaveBeenCalledWith({
      statusCode: 503,
      code: 'SERVICE_UNAVAILABLE',
      message: 'Ocurrio un error interno',
      requestId,
    });
  });

  it('returns the same request id in header and body', () => {
    const fixture = createFixture();
    fixture.filter.catch(new Error('failure'), fixture.host);

    expect(fixture.reply.header).toHaveBeenCalledWith(
      'x-request-id',
      requestId,
    );
    expect(fixture.reply.status).toHaveBeenCalledWith(500);
  });
});
