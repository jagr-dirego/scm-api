import { describe, expect, it } from 'vitest';
import { parseAuditPayload } from './audit.contracts';
import { AuditValidationError } from './errors/audit.error';

describe('audit contracts', () => {
  it('accepts an approved action, entity and exact payload', () => {
    expect(
      parseAuditPayload({
        action: 'users.status_changed',
        entityName: 'users',
        beforeData: { status: 'active' },
        afterData: {
          status: 'inactive',
          deactivatedAt: '2026-08-18T18:00:00.000Z',
        },
        metadata: { reason: 'Baja administrativa' },
      }),
    ).toEqual({
      action: 'users.status_changed',
      entityName: 'users',
      beforeData: { status: 'active' },
      afterData: {
        status: 'inactive',
        deactivatedAt: '2026-08-18T18:00:00.000Z',
      },
      metadata: { reason: 'Baja administrativa' },
    });
  });

  it.each([
    {
      action: 'users.unknown',
      entityName: 'users',
      afterData: { status: 'inactive' },
    },
    {
      action: 'users.status_changed',
      entityName: 'roles',
      afterData: { status: 'inactive' },
    },
    {
      action: 'users.status_changed',
      entityName: 'users',
      afterData: { status: 'inactive', password: 'must-not-be-recorded' },
    },
    {
      action: 'imports.batch_status_changed',
      entityName: 'import_batches',
      metadata: { accessToken: 'must-not-be-recorded' },
    },
  ])('rejects payload outside the approved contract', (input) => {
    expect(() => parseAuditPayload(input)).toThrow(AuditValidationError);
  });
});
