import type { NestFastifyApplication } from '@nestjs/platform-fastify';

export const HSTS_HEADER_VALUE = 'max-age=31536000';

interface SecurityHeaderReply {
  header(name: string, value: string): unknown;
}

interface FastifySecurityHeadersHost {
  addHook(
    name: 'onSend',
    hook: (
      request: unknown,
      reply: SecurityHeaderReply,
      payload: unknown,
      done: (error: Error | null, payload?: unknown) => void,
    ) => void,
  ): void;
}

export function configureSecurityHeaders(
  app: Pick<NestFastifyApplication, 'getHttpAdapter'>,
  nodeEnvironment: string,
): void {
  if (nodeEnvironment !== 'production') {
    return;
  }

  const fastify = app
    .getHttpAdapter()
    .getInstance() as FastifySecurityHeadersHost;

  fastify.addHook('onSend', (_request, reply, payload, done) => {
    reply.header('Strict-Transport-Security', HSTS_HEADER_VALUE);
    done(null, payload);
  });
}
