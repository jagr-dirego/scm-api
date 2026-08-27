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
    ) => Promise<unknown>,
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
    .getInstance<FastifySecurityHeadersHost>();

  fastify.addHook('onSend', async (_request, reply, payload) => {
    reply.header('Strict-Transport-Security', HSTS_HEADER_VALUE);
    return payload;
  });
}
