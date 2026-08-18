import { Injectable } from '@nestjs/common';
import { AuthorizationRepository } from './authorization.repository';
import type {
  AuthorizationInput,
  PermissionRequirement,
} from './authorization.types';

@Injectable()
export class AuthorizationService {
  constructor(private readonly repository: AuthorizationRepository) {}

  async isAllowed(
    input: AuthorizationInput,
    requirement: PermissionRequirement,
  ): Promise<boolean> {
    if (requirement.permissions.length === 0) return false;

    const decisions = await this.repository.resolvePermissions(input);
    const allowedCodes = new Set(
      decisions
        .filter((decision) => decision.allowed)
        .map((decision) => decision.permissionCode),
    );

    return requirement.mode === 'any'
      ? requirement.permissions.some((code) => allowedCodes.has(code))
      : requirement.permissions.every((code) => allowedCodes.has(code));
  }
}
