import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { ImportAuthorizationRepository } from './import-authorization.repository';

const input = {
  identity: {
    userId: '10000000-0000-4000-8000-000000000001',
    organizationId: '10000000-0000-4000-8000-000000000002',
    sessionId: '10000000-0000-4000-8000-000000000003',
    tokenId: '10000000-0000-4000-8000-000000000004',
    issuedAt: 1,
    expiresAt: 2,
  },
  actionPermissionCode: 'imports.upload',
  documentTypeCode: 'stock',
  fileBranchCode: 'general',
};

describe('ImportAuthorizationRepository', () => {
  it('denies when no active profile and identity combination exists', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const repository = new ImportAuthorizationRepository(
      pool as unknown as Pool,
    );

    await expect(repository.resolve(input)).resolves.toEqual({
      allowed: false,
      profile: null,
    });
  });

  it('parameterizes identity, action, document type and file branch', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            allowed: true,
            profile_id: 'profile-id',
            profile_code: 'stock_general',
            document_type_id: 'document-type-id',
            file_branch_id: 'file-branch-id',
            file_structure_id: 'file-structure-id',
            destination_table: 'stock_records',
            parser_version: 'v1',
          },
        ],
      }),
    };
    const repository = new ImportAuthorizationRepository(
      pool as unknown as Pool,
    );

    await expect(repository.resolve(input)).resolves.toMatchObject({
      allowed: true,
      profile: { code: 'stock_general' },
    });
    expect(pool.query).toHaveBeenCalledWith(expect.any(String), [
      input.identity.userId,
      input.identity.organizationId,
      input.actionPermissionCode,
      input.documentTypeCode,
      input.fileBranchCode,
    ]);
  });

  it('evaluates all role dimensions in one applicable role row', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const repository = new ImportAuthorizationRepository(
      pool as unknown as Pool,
    );

    await repository.resolve(input);

    const sql = pool.query.mock.calls[0]?.[0] as string;
    expect(sql).toContain('FROM applicable_roles AS role_record');
    expect(sql).toContain('role_record.allows_action');
    expect(sql).toContain('role_record.allows_type');
    expect(sql).toContain('role_record.allows_branch');
    expect(sql).not.toContain('imports.type.');
    expect(sql).not.toContain('imports.branch.');
  });

  it('lists authorized profiles with optional filters in one query', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            profile_code: 'stock_general',
            profile_name: 'Stock - General',
            document_type_code: 'stock',
            document_type_name: 'Stock',
            file_branch_code: 'general',
            file_branch_name: 'General',
          },
        ],
      }),
    };
    const repository = new ImportAuthorizationRepository(
      pool as unknown as Pool,
    );

    await expect(
      repository.listAuthorized({
        identity: input.identity,
        actionPermissionCode: 'imports.upload',
        documentTypeCode: 'stock',
      }),
    ).resolves.toEqual([
      {
        code: 'stock_general',
        name: 'Stock - General',
        documentType: { code: 'stock', name: 'Stock' },
        fileBranch: { code: 'general', name: 'General' },
      },
    ]);
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query).toHaveBeenCalledWith(expect.any(String), [
      input.identity.userId,
      input.identity.organizationId,
      'imports.upload',
      'stock',
      null,
    ]);
  });

  it('keeps role dimensions together, deny overrides and deterministic order', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const repository = new ImportAuthorizationRepository(
      pool as unknown as Pool,
    );

    await repository.listAuthorized({
      identity: input.identity,
      actionPermissionCode: 'imports.upload',
    });

    const sql = pool.query.mock.calls[0]?.[0] as string;
    expect(sql).toContain('evaluated.action_override = false');
    expect(sql).toContain('assignment.role_id');
    expect(sql).toContain('role_permission.role_id = assignment.role_id');
    expect(sql).toContain('type_permission.role_id = assignment.role_id');
    expect(sql).toContain('branch_permission.role_id = assignment.role_id');
    expect(sql).toContain(
      'ORDER BY evaluated.sort_order, evaluated.profile_code',
    );
  });
});
