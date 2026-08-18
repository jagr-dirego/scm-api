import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestContext } from './request-context.service';

export const requestContextStorage = new AsyncLocalStorage<RequestContext>();
