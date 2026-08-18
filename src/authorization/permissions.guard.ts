import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { z } from 'zod';
import type { AuthenticatedRequest } from '../auth/access-session.guard';
import { PERMISSION_REQUIREMENT } from './authorization.constants';
import { AuthorizationService } from './authorization.service';
import type { PermissionRequirement } from './authorization.types';

interface AuthorizedRequest extends AuthenticatedRequest {
  params?: Record<string, string | undefined>;
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirement = this.reflector.getAllAndOverride<PermissionRequirement>(
      PERMISSION_REQUIREMENT,
      [context.getHandler(), context.getClass()],
    );
    if (!requirement || requirement.permissions.length === 0) {
      return this.deny();
    }

    const request = context.switchToHttp().getRequest<AuthorizedRequest>();
    if (!request.auth) {
      throw new UnauthorizedException({
        statusCode: 401,
        code: 'AUTH_REQUIRED',
        message: 'Se requiere una sesion autenticada',
      });
    }

    const branchId = requirement.branchParam
      ? request.params?.[requirement.branchParam]
      : undefined;
    if (
      requirement.branchParam &&
      !z.string().uuid().safeParse(branchId).success
    ) {
      return this.deny();
    }

    let allowed: boolean;
    try {
      allowed = await this.authorizationService.isAllowed(
        {
          identity: request.auth,
          permissionCodes: requirement.permissions,
          ...(branchId ? { branchId } : {}),
        },
        requirement,
      );
    } catch {
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'AUTHORIZATION_UNAVAILABLE',
        message: 'No fue posible validar los permisos',
      });
    }
    return allowed ? true : this.deny();
  }

  private deny(): never {
    throw new ForbiddenException({
      statusCode: 403,
      code: 'AUTHORIZATION_DENIED',
      message: 'No cuenta con permisos para realizar esta accion',
    });
  }
}
