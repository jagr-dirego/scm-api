import { Injectable } from '@nestjs/common';
import { requestContextStorage } from './request-context.storage';

export interface RequestContext {
  requestId: string;
}

@Injectable()
export class RequestContextService {
  run<T>(context: RequestContext, callback: () => T): T {
    return requestContextStorage.run(Object.freeze({ ...context }), callback);
  }

  getRequestId(): string | undefined {
    return requestContextStorage.getStore()?.requestId;
  }
}
