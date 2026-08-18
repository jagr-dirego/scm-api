import type { VerifiedAccessToken } from '../auth/token.service';

export interface PermissionRequirement {
  permissions: readonly string[];
  mode: 'all' | 'any';
  branchParam?: string;
}

export interface PermissionDecision {
  permissionCode: string;
  allowed: boolean;
}

export interface AuthorizationInput {
  identity: VerifiedAccessToken;
  permissionCodes: readonly string[];
  branchId?: string;
}
