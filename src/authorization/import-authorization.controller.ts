import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/access-session.guard';
import { ImportAuthorizationService } from './import-authorization.service';
import { RequirePermissions } from './require-permissions.decorator';

@ApiTags('authorization')
@ApiBearerAuth()
@Controller('authorization/imports')
export class ImportAuthorizationController {
  constructor(private readonly service: ImportAuthorizationService) {}

  @Get('profiles/:documentTypeCode/:fileBranchCode')
  @RequirePermissions(['imports.upload'])
  @ApiOperation({
    summary: 'Validar acceso de carga y resolver el perfil de importacion',
  })
  @ApiParam({ name: 'documentTypeCode', example: 'stock' })
  @ApiParam({ name: 'fileBranchCode', example: 'general' })
  @ApiResponse({ status: 200, description: 'Perfil de carga autorizado' })
  @ApiResponse({ status: 401, description: 'Sesion no valida' })
  @ApiResponse({ status: 403, description: 'Combinacion no autorizada' })
  @ApiResponse({ status: 503, description: 'Autorizacion no disponible' })
  async resolveUploadProfile(
    @Param('documentTypeCode') documentTypeCode: string,
    @Param('fileBranchCode') fileBranchCode: string,
    @Req() request: AuthenticatedRequest,
  ) {
    if (!request.auth) {
      throw new UnauthorizedException({
        statusCode: 401,
        code: 'AUTH_REQUIRED',
        message: 'Se requiere una sesion autenticada',
      });
    }

    try {
      const decision = await this.service.authorize({
        identity: request.auth,
        actionPermissionCode: 'imports.upload',
        documentTypeCode,
        fileBranchCode,
      });
      if (!decision.allowed || !decision.profile) return this.deny();
      return { profile: decision.profile };
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'IMPORT_AUTHORIZATION_UNAVAILABLE',
        message: 'No fue posible validar el perfil de importacion',
      });
    }
  }

  private deny(): never {
    throw new ForbiddenException({
      statusCode: 403,
      code: 'IMPORT_PROFILE_NOT_AUTHORIZED',
      message: 'El perfil de importacion no existe o no esta autorizado',
    });
  }
}
