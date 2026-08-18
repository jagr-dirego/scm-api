import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ZodError } from 'zod';
import { AuthService } from './auth.service';
import { AuthenticationError } from './errors/authentication.error';
import type { LoginInput } from './schemas/login.schema';

interface LoginRequest {
  ip: string;
  headers: Record<string, string | string[] | undefined>;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @ApiOperation({ summary: 'Validar identidad y contexto organizacional' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['email', 'password'],
      properties: {
        email: { type: 'string', format: 'email', maxLength: 254 },
        password: {
          type: 'string',
          minLength: 1,
          maxLength: 128,
          writeOnly: true,
        },
        organizationCode: { type: 'string', minLength: 1, maxLength: 50 },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Identidad validada; no crea una sesion',
  })
  @ApiResponse({ status: 401, description: 'Credenciales no validas' })
  async login(@Body() body: LoginInput, @Req() request: LoginRequest) {
    try {
      return await this.authService.login(body, {
        ipAddress: request.ip,
        userAgent: this.readUserAgent(request),
      });
    } catch (error) {
      if (error instanceof ZodError) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'VALIDATION_ERROR',
          message: 'Datos de entrada invalidos',
        });
      }
      if (error instanceof AuthenticationError) {
        throw new UnauthorizedException({
          statusCode: 401,
          code: error.code,
          message: error.message,
        });
      }
      throw error;
    }
  }

  private readUserAgent(request: LoginRequest): string | undefined {
    const value = request.headers['user-agent'];
    return typeof value === 'string' ? value.slice(0, 1024) : undefined;
  }
}
