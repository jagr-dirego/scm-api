import { describe, expect, it } from 'vitest';
import { isRequestId, resolveRequestId } from './request-id';

const valid = '10000000-0000-4000-8000-000000000001';

describe('request id', () => {
  it('accepts only UUID v4 values', () => {
    expect(isRequestId(valid)).toBe(true);
    expect(isRequestId(valid.toUpperCase())).toBe(true);
    expect(isRequestId('10000000-0000-1000-8000-000000000001')).toBe(false);
    expect(isRequestId('client-controlled-value')).toBe(false);
    expect(isRequestId(['header-array'])).toBe(false);
  });

  it('normalizes a trusted request id', () => {
    expect(resolveRequestId(valid.toUpperCase())).toBe(valid);
  });

  it.each([undefined, '', 'invalid', ['one', 'two']])(
    'replaces an invalid candidate %s with a UUID v4',
    (candidate) => {
      const requestId = resolveRequestId(candidate);

      expect(isRequestId(requestId)).toBe(true);
      expect(requestId).not.toEqual(candidate);
    },
  );
});
