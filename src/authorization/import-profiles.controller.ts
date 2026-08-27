import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
  type SchemaObject,
} from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthenticatedRequest } from '../auth/access-session.guard';
import { ImportAuthorizationService } from './import-authorization.service';
import { RequirePermissions } from './require-permissions.decorator';

const filtersSchema = z.object({
  documentTypeCode: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]+$/)
    .optional(),
  fileBranchCode: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]+$/)
    .optional(),
});

const responseSchema: SchemaObject = {
  type: 'object',
  required: ['profiles'],
  properties: {
    profiles: {
      type: 'array',
      items: {
        type: 'object',
        required: ['code', 'name', 'documentType', 'fileBranch'],
        properties: {
          code: { type: 'string', example: 'stock_general' },
          name: { type: 'string', example: 'Stock - General' },
          documentType: {
            type: 'object',
            required: ['code', 'name'],
            properties: {
              code: { type: 'string', example: 'stock' },
              name: { type: 'string', example: 'Stock' },
            },
          },
          fileBranch: {
            type: 'object',
            required: ['code', 'name'],
            properties: {
              code: { type: 'string', example: 'general' },
              name: { type: 'string', example: 'General' },
            },
          },
        },
      },
    },
  },
};

@ApiTags('imports')
@ApiBearerAuth()
@Controller('imports')
export class ImportProfilesController {
  constructor(private readonly service: ImportAuthorizationService) {}

  @Get('profiles')
  @RequirePermissions(['imports.upload'])
  @ApiOperation({ summary: 'Listar perfiles de importacion autorizados' })
  @ApiQuery({ name: 'documentTypeCode', required: false, example: 'stock' })
  @ApiQuery({ name: 'fileBranchCode', required: false, example: 'general' })
  @ApiResponse({
    status: 200,
    description: 'Perfiles autorizados',
    schema: responseSchema,
  })
  @ApiResponse({ status: 400, description: 'Filtros invalidos' })
  @ApiResponse({ status: 401, description: 'Sesion no valida' })
  @ApiResponse({ status: 403, description: 'Permiso de carga requerido' })
  @ApiResponse({ status: 503, description: 'Perfiles no disponibles' })
  async list(
    @Query() query: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ) {
    if (!request.auth) {
      throw new UnauthorizedException({
        statusCode: 401,
        code: 'AUTH_REQUIRED',
        message: 'Se requiere una sesion autenticada',
      });
    }

    const filters = filtersSchema.safeParse(query);
    if (!filters.success) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'Los filtros de perfiles no son validos',
      });
    }

    try {
      const profiles = await this.service.listAuthorized({
        identity: request.auth,
        actionPermissionCode: 'imports.upload',
        ...filters.data,
      });
      if (!profiles) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'VALIDATION_ERROR',
          message: 'Los filtros de perfiles no son validos',
        });
      }
      return { profiles };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'IMPORT_PROFILES_UNAVAILABLE',
        message: 'No fue posible consultar los perfiles de importacion',
      });
    }
  }
}
