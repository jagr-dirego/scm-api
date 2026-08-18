import type { Pool, PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { AuditRepository } from './audit.repository';

const event = {
  organizationId: '10000000-0000-4000-8000-000000000001',
  actorUserId: '10000000-0000-4000-8000-000000000002',
  actorSessionId: '10000000-0000-4000-8000-000000000003',
  action: 'users.status_changed',
  entityName: 'users',
  entityId: '10000000-0000-4000-8000-000000000004',
  beforeData: { status: 'active' },
  afterData: { status: 'inactive' },
  metadata: { reason: 'test' },
  ipAddress: '127.0.0.1',
  userAgent: 'vitest',
  requestId: '10000000-0000-4000-8000-000000000005',
};

describe('AuditRepository', () => {
  it('inserts every value using parameters', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: 'audit-id' }] }),
    };
    const repository = new AuditRepository(pool as unknown as Pool);

    await expect(repository.insert(event)).resolves.toBe('audit-id');
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('session_record.organization_id = $1'),
      [
        event.organizationId,
        event.actorUserId,
        event.actorSessionId,
        event.action,
        event.entityName,
        event.entityId,
        event.beforeData,
        event.afterData,
        event.metadata,
        event.ipAddress,
        event.userAgent,
        event.requestId,
      ],
    );
  });

  it('uses the caller transaction instead of the pool', async () => {
    const pool = { query: vi.fn() };
    const transaction = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: 'audit-id' }] }),
    };
    const repository = new AuditRepository(pool as unknown as Pool);

    await repository.insert(event, transaction as unknown as PoolClient);

    expect(transaction.query).toHaveBeenCalledOnce();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('fails when PostgreSQL does not return an audit id', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const repository = new AuditRepository(pool as unknown as Pool);

    await expect(repository.insert(event)).rejects.toThrow(
      'Audit insert did not return an id',
    );
  });
});
