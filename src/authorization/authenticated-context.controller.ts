import {
  Controller,
  Get,
  Header,
  Inject,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  type SchemaObject,
} from '@nestjs/swagger';
import {
  AccessSessionGuard,
  type AuthenticatedRequest,
} from '../auth/access-session.guard';
import { AuthenticatedContextService } from './authenticated-context.service';

const authenticatedContextOpenApiSchema: SchemaObject = {
  type: 'object',
  required: ['user', 'organization', 'membership', 'session', 'capabilities'],
  properties: {
    user: {
      type: 'object',
      required: ['id', 'email', 'displayName'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        email: { type: 'string', format: 'email' },
        displayName: { type: 'string' },
      },
    },
    organization: {
      type: 'object',
      required: ['id', 'code', 'name'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        code: { type: 'string' },
        name: { type: 'string' },
      },
    },
    membership: {
      type: 'object',
      required: ['id', 'defaultBranch'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        defaultBranch: {
          nullable: true,
          type: 'object',
          required: ['id', 'code', 'name'],
          properties: {
            id: { type: 'string', format: 'uuid' },
            code: { type: 'string' },
            name: { type: 'string' },
          },
        },
      },
    },
    session: {
      type: 'object',
      required: ['id', 'idleExpiresAt', 'absoluteExpiresAt'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        idleExpiresAt: { type: 'string', format: 'date-time' },
        absoluteExpiresAt: { type: 'string', format: 'date-time' },
      },
    },
    capabilities: {
      type: 'array',
      items: { type: 'string' },
      uniqueItems: true,
    },
  },
};

@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth')
export class AuthenticatedContextController {
  constructor(
    @Inject(AuthenticatedContextService)
    private readonly service: AuthenticatedContextService,
  ) {}

  @Get('me')
  @UseGuards(AccessSessionGuard)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Obtener identidad y capacidades efectivas' })
  @ApiResponse({
    status: 200,
    description: 'Contexto autenticado vigente',
    headers: {
      'Cache-Control': {
        description: 'Impide almacenar contexto autenticado',
        schema: { type: 'string', example: 'no-store' },
      },
    },
    schema: authenticatedContextOpenApiSchema,
  })
  @ApiResponse({ status: 401, description: 'Sesion no valida' })
  @ApiResponse({ status: 503, description: 'Contexto no disponible' })
  async getContext(@Req() request: AuthenticatedRequest) {
    if (!request.auth) return this.unauthorized();

    let context;
    try {
      context = await this.service.resolve(request.auth);
    } catch {
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'AUTH_CONTEXT_UNAVAILABLE',
        message: 'No fue posible obtener el contexto autenticado',
      });
    }

    return context ?? this.unauthorized();
  }

  private unauthorized(): never {
    throw new UnauthorizedException({
      statusCode: 401,
      code: 'AUTH_INVALID_ACCESS_TOKEN',
      message: 'Access token no valido',
    });
  }
}
