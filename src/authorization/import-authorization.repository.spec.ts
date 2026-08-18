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
});
