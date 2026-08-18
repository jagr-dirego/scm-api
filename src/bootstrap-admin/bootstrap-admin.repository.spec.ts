import type { Pool, QueryResult } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { BootstrapAdminRepository } from './bootstrap-admin.repository';
import { BootstrapAlreadyCompletedError } from './errors/bootstrap.errors';
import type { ValidatedBootstrapInput } from './schemas/bootstrap-input.schema';

const input: ValidatedBootstrapInput = {
  organizationCode: 'DIREGO',
  organizationName: 'Dirego',
  organizationSlug: 'dirego',
  email: 'admin@dirego.test',
  displayName: 'Administrador',
  password: 'NotStoredInRepository1!',
};

const queryResult = <T extends Record<string, unknown>>(
  rows: T[],
): QueryResult<T> => ({ rows, rowCount: rows.length }) as QueryResult<T>;

describe('BootstrapAdminRepository', () => {
  it('commits all bootstrap records and releases the connection', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(queryResult([]))
      .mockResolvedValueOnce(queryResult([]))
      .mockResolvedValueOnce(queryResult([{ id: 'role-id' }]))
      .mockResolvedValueOnce(queryResult([]))
      .mockResolvedValueOnce(queryResult([{ exists: false }]))
      .mockResolvedValueOnce(queryResult([{ id: 'organization-id' }]))
      .mockResolvedValueOnce(queryResult([{ id: 'user-id' }]))
      .mockResolvedValueOnce(queryResult([{ id: 'membership-id' }]))
      .mockResolvedValueOnce(queryResult([{ id: 'assignment-id' }]))
      .mockResolvedValueOnce(queryResult([]))
      .mockResolvedValueOnce(queryResult([]));
    const release = vi.fn();
    const pool = {
      connect: vi.fn().mockResolvedValue({ query, release }),
    } as unknown as Pool;

    const result = await new BootstrapAdminRepository(pool).execute(
      input,
      '$argon2id$hash',
    );

    expect(result).toEqual({
      organizationId: 'organization-id',
      userId: 'user-id',
      membershipId: 'membership-id',
      roleAssignmentId: 'assignment-id',
    });
    expect(query.mock.calls[0]?.[0]).toBe('BEGIN');
    expect(query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    expect(
      query.mock.calls.some(([statement]) =>
        String(statement).includes('user_memberships'),
      ),
    ).toBe(true);
    expect(release).toHaveBeenCalledOnce();
  });

  it('rolls back and releases the connection when bootstrap was already completed', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(queryResult([]))
      .mockResolvedValueOnce(queryResult([]))
      .mockResolvedValueOnce(queryResult([{ id: 'role-id' }]))
      .mockResolvedValueOnce(queryResult([{ id: 'assignment-id' }]))
      .mockResolvedValueOnce(queryResult([]));
    const release = vi.fn();
    const pool = {
      connect: vi.fn().mockResolvedValue({ query, release }),
    } as unknown as Pool;

    await expect(
      new BootstrapAdminRepository(pool).execute(input, '$argon2id$hash'),
    ).rejects.toBeInstanceOf(BootstrapAlreadyCompletedError);

    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
  });
});
