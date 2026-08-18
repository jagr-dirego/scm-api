import { describe, expect, it } from 'vitest';
import { RequestContextService } from './request-context.service';

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

describe('RequestContextService', () => {
  it('returns undefined outside a request context', () => {
    const service = new RequestContextService();

    expect(service.getRequestId()).toBeUndefined();
  });

  it('propagates request id through asynchronous work', async () => {
    const service = new RequestContextService();

    await service.run({ requestId: 'request-a' }, async () => {
      await wait(1);
      expect(service.getRequestId()).toBe('request-a');
    });
    expect(service.getRequestId()).toBeUndefined();
  });

  it('isolates concurrent request contexts', async () => {
    const service = new RequestContextService();
    const values = await Promise.all([
      service.run({ requestId: 'request-a' }, async () => {
        await wait(5);
        return service.getRequestId();
      }),
      service.run({ requestId: 'request-b' }, async () => {
        await wait(1);
        return service.getRequestId();
      }),
    ]);

    expect(values).toEqual(['request-a', 'request-b']);
  });
});
