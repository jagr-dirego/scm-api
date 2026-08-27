import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedRequest } from '../auth/access-session.guard';
import { AccessSessionGuard } from '../auth/access-session.guard';
import { PERMISSION_REQUIREMENT } from './authorization.constants';
import type { ImportAuthorizationService } from './import-authorization.service';
import { ImportProfilesController } from './import-profiles.controller';
import { PermissionsGuard } from './permissions.guard';

const identity = {
  userId: '10000000-0000-4000-8000-000000000001',
  organizationId: '10000000-0000-4000-8000-000000000002',
  sessionId: '10000000-0000-4000-8000-000000000003',
  tokenId: '10000000-0000-4000-8000-000000000004',
  issuedAt: 1,
  expiresAt: 2,
};

const createController = () => {
  const service = { listAuthorized: vi.fn() };
  return {
    service,
    controller: new ImportProfilesController(
      service as unknown as ImportAuthorizationService,
    ),
  };
};

describe('ImportProfilesController', () => {
  it('requires an authenticated user with imports.upload', () => {
    const handler = Object.getOwnPropertyDescriptor(
      ImportProfilesController.prototype,
      'list',
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

  it('returns only public profile fields and accepts an empty list', async () => {
    const fixture = createController();
    fixture.service.listAuthorized.mockResolvedValue([]);

    await expect(
      fixture.controller.list({}, { auth: identity } as AuthenticatedRequest),
    ).resolves.toEqual({ profiles: [] });
    expect(fixture.service.listAuthorized).toHaveBeenCalledWith({
      identity,
      actionPermissionCode: 'imports.upload',
    });
  });

  it('passes normalized optional filters to the service', async () => {
    const fixture = createController();
    fixture.service.listAuthorized.mockResolvedValue([]);

    await fixture.controller.list(
      { documentTypeCode: ' stock ', fileBranchCode: ' general ' },
      { auth: identity } as AuthenticatedRequest,
    );

    expect(fixture.service.listAuthorized).toHaveBeenCalledWith({
      identity,
      actionPermissionCode: 'imports.upload',
      documentTypeCode: 'stock',
      fileBranchCode: 'general',
    });
  });

  it('rejects invalid filters without querying the service', async () => {
    const fixture = createController();

    await expect(
      fixture.controller.list({ documentTypeCode: 'stock-sale' }, {
        auth: identity,
      } as AuthenticatedRequest),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fixture.service.listAuthorized).not.toHaveBeenCalled();
  });

  it('requires the identity attached by the session guard', async () => {
    const fixture = createController();

    await expect(
      fixture.controller.list({}, {} as AuthenticatedRequest),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('returns a stable unavailable response without internal details', async () => {
    const fixture = createController();
    fixture.service.listAuthorized.mockRejectedValue(
      new Error('private PostgreSQL detail'),
    );

    await expect(
      fixture.controller.list({}, { auth: identity } as AuthenticatedRequest),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
