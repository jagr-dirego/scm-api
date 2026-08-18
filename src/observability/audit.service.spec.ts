import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import type { AuditRepository } from './audit.repository';
import { AuditService } from './audit.service';
import { AuditContextError, AuditValidationError } from './errors/audit.error';
import type { RequestContextService } from './request-context.service';

const requestId = '10000000-0000-4000-8000-000000000001';
const input = {
  actor: {
    userId: '10000000-0000-4000-8000-000000000002',
    organizationId: '10000000-0000-4000-8000-000000000003',
    sessionId: '10000000-0000-4000-8000-000000000004',
    tokenId: '10000000-0000-4000-8000-000000000005',
    issuedAt: 1,
    expiresAt: 2,
  },
  action: 'users.status_changed',
  entityName: 'users',
  entityId: '10000000-0000-4000-8000-000000000006',
  beforeData: { status: 'active' },
  afterData: { status: 'inactive' },
  metadata: { reason: 'Baja administrativa' },
  ipAddress: '127.0.0.1',
  userAgent: 'vitest',
};

const createService = (
  activeRequestId: string | null | undefined = requestId,
) => {
  const repository = { insert: vi.fn().mockResolvedValue('audit-id') };
  const context = { getRequestId: vi.fn().mockReturnValue(activeRequestId) };
  return {
    repository,
    service: new AuditService(
      repository as unknown as AuditRepository,
      context as unknown as RequestContextService,
    ),
  };
};

describe('AuditService', () => {
  it('derives tenant, actor, session and request id from trusted context', async () => {
    const fixture = createService();

    await expect(fixture.service.record(input)).resolves.toBe('audit-id');
    expect(fixture.repository.insert).toHaveBeenCalledWith(
      {
        organizationId: input.actor.organizationId,
        actorUserId: input.actor.userId,
        actorSessionId: input.actor.sessionId,
        action: input.action,
        entityName: input.entityName,
        entityId: input.entityId,
        beforeData: input.beforeData,
        afterData: input.afterData,
        metadata: input.metadata,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        requestId,
      },
      undefined,
    );
  });

  it('passes through the transaction required by a sensitive operation', async () => {
    const fixture = createService();
    const transaction = {} as PoolClient;

    await fixture.service.record(input, transaction);

    expect(fixture.repository.insert).toHaveBeenCalledWith(
      expect.any(Object),
      transaction,
    );
  });

  it('rejects audit outside an active request context', async () => {
    const fixture = createService(null);

    await expect(fixture.service.record(input)).rejects.toBeInstanceOf(
      AuditContextError,
    );
    expect(fixture.repository.insert).not.toHaveBeenCalled();
  });

  it('rejects unapproved fields before calling the repository', async () => {
    const fixture = createService();

    await expect(
      fixture.service.record({
        ...input,
        afterData: { status: 'inactive', password: 'private-password' },
      }),
    ).rejects.toBeInstanceOf(AuditValidationError);
    expect(fixture.repository.insert).not.toHaveBeenCalled();
  });

  it('does not swallow a mandatory audit write failure', async () => {
    const fixture = createService();
    fixture.repository.insert.mockRejectedValue(new Error('database failure'));

    await expect(fixture.service.record(input)).rejects.toThrow(
      'database failure',
    );
  });
});
