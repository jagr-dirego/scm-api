import { describe, expect, it, vi } from 'vitest';
import type { ImportAuthorizationRepository } from './import-authorization.repository';
import { ImportAuthorizationService } from './import-authorization.service';

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

const createService = () => {
  const repository = { resolve: vi.fn() };
  return {
    repository,
    service: new ImportAuthorizationService(
      repository as unknown as ImportAuthorizationRepository,
    ),
  };
};

describe('ImportAuthorizationService', () => {
  it('normalizes codes before resolving authorization', async () => {
    const fixture = createService();
    fixture.repository.resolve.mockResolvedValue({
      allowed: false,
      profile: null,
    });

    await fixture.service.authorize({
      ...input,
      actionPermissionCode: ' imports.upload ',
      documentTypeCode: ' stock ',
      fileBranchCode: ' general ',
    });

    expect(fixture.repository.resolve).toHaveBeenCalledWith(input);
  });

  it.each([
    { actionPermissionCode: 'users.write' },
    { actionPermissionCode: 'imports.UPLOAD' },
    { documentTypeCode: 'traslado-sale' },
    { fileBranchCode: '' },
    {
      identity: {
        ...input.identity,
        organizationId: 'client-selected-tenant',
      },
    },
  ])('denies invalid input without querying PostgreSQL', async (change) => {
    const fixture = createService();

    await expect(
      fixture.service.authorize({ ...input, ...change }),
    ).resolves.toEqual({ allowed: false, profile: null });
    expect(fixture.repository.resolve).not.toHaveBeenCalled();
  });

  it('returns the repository decision without broadening access', async () => {
    const fixture = createService();
    const decision = {
      allowed: true,
      profile: {
        id: '10000000-0000-4000-8000-000000000005',
        code: 'stock_general',
        documentTypeId: '10000000-0000-4000-8000-000000000006',
        fileBranchId: '10000000-0000-4000-8000-000000000007',
        fileStructureId: '10000000-0000-4000-8000-000000000008',
        destinationTable: 'stock_records',
        parserVersion: 'v1',
      },
    };
    fixture.repository.resolve.mockResolvedValue(decision);

    await expect(fixture.service.authorize(input)).resolves.toEqual(decision);
  });
});
