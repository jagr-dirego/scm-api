import type { IncomingMessage } from 'node:http';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { requestContextStorage } from './request-context.storage';
import { resolveRequestId } from './request-id';

export const createFastifyAdapter = (): FastifyAdapter => {
  const adapter = new FastifyAdapter({
    logger: false,
    genReqId: (request: IncomingMessage) =>
      resolveRequestId(request.headers['x-request-id']),
  });
  adapter.getInstance().addHook('onRequest', (request, reply, done) => {
    requestContextStorage.run(Object.freeze({ requestId: request.id }), () => {
      void reply.header('x-request-id', request.id);
      done();
    });
  });
  return adapter;
};
