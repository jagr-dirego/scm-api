import { describe, expect, it, vi } from 'vitest';
import {
  configureSecurityHeaders,
  HSTS_HEADER_VALUE,
} from './configure-security-headers';

describe('configureSecurityHeaders', () => {
  it('adds HSTS to production responses', () => {
    const addHook = vi.fn();
    const app = {
      getHttpAdapter: () => ({
        getInstance: () => ({ addHook }),
      }),
    };

    configureSecurityHeaders(app as never, 'production');

    expect(addHook).toHaveBeenCalledWith('onSend', expect.any(Function));
    const hook = addHook.mock.calls[0]?.[1] as (
      request: unknown,
      reply: { header: (name: string, value: string) => void },
      payload: unknown,
    ) => unknown;
    const header = vi.fn();

    expect(hook({}, { header }, { ok: true })).toEqual({
      ok: true,
    });
    expect(header).toHaveBeenCalledWith(
      'Strict-Transport-Security',
      HSTS_HEADER_VALUE,
    );
  });

  it('does not add HSTS outside production', () => {
    const addHook = vi.fn();
    const app = {
      getHttpAdapter: () => ({
        getInstance: () => ({ addHook }),
      }),
    };

    configureSecurityHeaders(app as never, 'development');

    expect(addHook).not.toHaveBeenCalled();
  });
});
