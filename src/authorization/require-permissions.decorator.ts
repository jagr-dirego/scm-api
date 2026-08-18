import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { AccessSessionGuard } from '../auth/access-session.guard';
import { PERMISSION_REQUIREMENT } from './authorization.constants';
import { PermissionsGuard } from './permissions.guard';
import type { PermissionRequirement } from './authorization.types';

export interface RequirePermissionsOptions {
  mode?: PermissionRequirement['mode'];
  branchParam?: string;
}

export const RequirePermissions = (
  permissions: readonly string[],
  options: RequirePermissionsOptions = {},
) => {
  const normalized = [
    ...new Set(permissions.map((value) => value.trim()).filter(Boolean)),
  ];
  const requirement: PermissionRequirement = {
    permissions: normalized,
    mode: options.mode ?? 'all',
    ...(options.branchParam ? { branchParam: options.branchParam } : {}),
  };
  return applyDecorators(
    SetMetadata(PERMISSION_REQUIREMENT, requirement),
    UseGuards(AccessSessionGuard, PermissionsGuard),
  );
};
