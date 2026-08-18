import {
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedRequest } from '../auth/access-session.guard';
import { AccessSessionGuard } from '../auth/access-session.guard';
import { PERMISSION_REQUIREMENT } from './authorization.constants';
import { ImportAuthorizationController } from './import-authorization.controller';
import type { ImportAuthorizationService } from './import-authorization.service';
import { PermissionsGuard } from './permissions.guard';

const identity = {
  userId: '10000000-0000-4000-8000-000000000001',
  organizationId: '10000000-0000-4000-8000-000000000002',
  sessionId: '10000000-0000-4000-8000-000000000003',
  tokenId: '10000000-0000-4000-8000-000000000004',
  issuedAt: 1,
  expiresAt: 2,
};

const profile = {
  id: '10000000-0000-4000-8000-000000000005',
  code: 'stock_general',
  documentTypeId: '10000000-0000-4000-8000-000000000006',
  fileBranchId: '10000000-0000-4000-8000-000000000007',
  fileStructureId: '10000000-0000-4000-8000-000000000008',
  destinationTable: 'stock_records',
  parserVersion: 'v1',
};

const createController = () => {
  const service = { authorize: vi.fn() };
  return {
    service,
    controller: new ImportAuthorizationController(
      service as unknown as ImportAuthorizationService,
    ),
  };
};

describe('ImportAuthorizationController', () => {
  it('declares authentication and imports.upload authorization guards', () => {
    const handler = Object.getOwnPropertyDescriptor(
      ImportAuthorizationController.prototype,
      'resolveUploadProfile',
    )?.value as (...args: unknown[]) => unknown;

    expect(Reflect.getMetadata(PERMISSION_REQUIREMENT, handler)).toEqual({
      permissions: ['imports.upload'],
      mode: 'all',
    });
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([
      AccessSessionGuard,
      PermissionsGuard,
    ]);
  });

  it('returns only the authorized import profile', async () => {
    const fixture = createController();
    fixture.service.authorize.mockResolvedValue({ allowed: true, profile });

    await expect(
      fixture.controller.resolveUploadProfile('stock', 'general', {
        auth: identity,
      } as AuthenticatedRequest),
    ).resolves.toEqual({ profile });
    expect(fixture.service.authorize).toHaveBeenCalledWith({
      identity,
      actionPermissionCode: 'imports.upload',
      documentTypeCode: 'stock',
      fileBranchCode: 'general',
    });
  });

  it('requires the identity attached by AccessSessionGuard', async () => {
    const fixture = createController();

    await expect(
      fixture.controller.resolveUploadProfile(
        'stock',
        'general',
        {} as AuthenticatedRequest,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(fixture.service.authorize).not.toHaveBeenCalled();
  });

  it.each([
    { allowed: false, profile },
    { allowed: true, profile: null },
  ])('does not reveal unavailable or denied profiles', async (decision) => {
    const fixture = createController();
    fixture.service.authorize.mockResolvedValue(decision);

    await expect(
      fixture.controller.resolveUploadProfile('stock', 'general', {
        auth: identity,
      } as AuthenticatedRequest),
    ).rejects.toMatchObject({
      response: { code: 'IMPORT_PROFILE_NOT_AUTHORIZED' },
    });
  });

  it('returns a stable unavailable response without database details', async () => {
    const fixture = createController();
    fixture.service.authorize.mockRejectedValue(
      new Error('private PostgreSQL detail'),
    );

    await expect(
      fixture.controller.resolveUploadProfile('stock', 'general', {
        auth: identity,
      } as AuthenticatedRequest),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('preserves the forbidden response raised by the authorization decision', async () => {
    const fixture = createController();
    fixture.service.authorize.mockResolvedValue({ allowed: false, profile });

    await expect(
      fixture.controller.resolveUploadProfile('stock', 'general', {
        auth: identity,
      } as AuthenticatedRequest),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
