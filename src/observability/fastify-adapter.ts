import type { IncomingMessage } from 'node:http';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { Logger } from 'pino';
import { requestContextStorage } from './request-context.storage';
import { resolveRequestId } from './request-id';

export const createFastifyAdapter = (logger?: Logger): FastifyAdapter => {
  const commonOptions = {
    genReqId: (request: IncomingMessage) =>
      resolveRequestId(request.headers['x-request-id']),
  };
  const adapter = new FastifyAdapter(
    logger
      ? { ...commonOptions, loggerInstance: logger }
      : { ...commonOptions, logger: false },
  );
  adapter.getInstance().addHook('onRequest', (request, reply, done) => {
    requestContextStorage.run(Object.freeze({ requestId: request.id }), () => {
      void reply.header('x-request-id', request.id);
      done();
    });
  });
  return adapter;
};
