import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Post,
  Param,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ZodError } from 'zod';
import { AuthHttpService, type CookieReply } from './auth-http.service';
import {
  AccessSessionGuard,
  type AuthenticatedRequest,
} from './access-session.guard';
import type {
  AuthenticatedIdentity,
  AuthenticationContext,
} from './auth.repository';
import { AuthService } from './auth.service';
import { AuthenticationError } from './errors/authentication.error';
import { CsrfValidationError } from './errors/csrf.error';
import {
  RefreshTokenError,
  SessionOperationError,
} from './errors/session.error';
import type { LoginInput } from './schemas/login.schema';
import { SessionService, type SessionTokenPair } from './session.service';

interface AuthRequest {
  ip: string;
  headers: Record<string, string | string[] | undefined>;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sessionService: SessionService,
    private readonly authHttpService: AuthHttpService,
  ) {}

  @Post('login')
  @ApiOperation({ summary: 'Autenticar y crear una sesion' })
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
  @ApiResponse({ status: 200, description: 'Sesion creada' })
  @ApiResponse({ status: 401, description: 'Credenciales no validas' })
  async login(
    @Body() body: LoginInput,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) reply: CookieReply,
  ) {
    try {
      this.authHttpService.assertTrustedOrigin(request);
      const context = this.context(request);
      const identity = await this.authService.login(body, context);
      const tokens = await this.sessionService.createSession(identity, context);
      this.authHttpService.setRefreshCookie(
        reply,
        tokens.refreshToken,
        tokens.idleExpiresAt,
      );
      return this.response(tokens, identity);
    } catch (error) {
      this.rethrow(error);
    }
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiCookieAuth('__Host-dirego_refresh')
  @ApiOperation({ summary: 'Rotar el refresh token y renovar el access token' })
  @ApiResponse({ status: 200, description: 'Sesion renovada' })
  @ApiResponse({ status: 401, description: 'Sesion no valida' })
  @ApiResponse({ status: 403, description: 'Origen no permitido' })
  async refresh(
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) reply: CookieReply,
  ) {
    try {
      this.authHttpService.assertTrustedOrigin(request);
      const current = this.authHttpService.readRefreshToken(request);
      const tokens = await this.sessionService.rotateSession(
        current,
        this.context(request),
      );
      this.authHttpService.setRefreshCookie(
        reply,
        tokens.refreshToken,
        tokens.idleExpiresAt,
      );
      return this.response(tokens);
    } catch (error) {
      if (error instanceof RefreshTokenError) {
        this.authHttpService.clearRefreshCookie(reply);
      }
      this.rethrow(error);
    }
  }

  @Post('logout')
  @HttpCode(204)
  @ApiCookieAuth('__Host-dirego_refresh')
  @ApiOperation({ summary: 'Revocar la sesion actual' })
  @ApiResponse({ status: 204, description: 'Sesion revocada' })
  async logout(
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) reply: CookieReply,
  ): Promise<void> {
    try {
      this.authHttpService.assertTrustedOrigin(request);
      const refreshToken = this.authHttpService.readRefreshToken(request);
      await this.sessionService.revokeSession(
        refreshToken,
        this.context(request),
      );
    } catch (error) {
      if (!(error instanceof RefreshTokenError)) this.rethrow(error);
    } finally {
      this.authHttpService.clearRefreshCookie(reply);
    }
  }

  @Get('sessions')
  @UseGuards(AccessSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar las sesiones activas propias' })
  @ApiResponse({ status: 200, description: 'Sesiones activas del usuario' })
  async listSessions(@Req() request: AuthenticatedRequest) {
    return {
      sessions: await this.sessionService.listSessions(
        this.authenticatedActor(request),
      ),
    };
  }

  @Delete('sessions/:sessionId')
  @HttpCode(204)
  @UseGuards(AccessSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revocar una sesion propia' })
  @ApiResponse({ status: 204, description: 'Operacion completada' })
  async revokeSession(
    @Param('sessionId') sessionId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    try {
      await this.sessionService.revokeOwnedSession(
        this.authenticatedActor(request),
        sessionId,
        this.context(request),
      );
    } catch (error) {
      this.rethrow(error);
    }
  }

  @Post('logout-all')
  @HttpCode(204)
  @UseGuards(AccessSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revocar todas las sesiones propias' })
  @ApiResponse({ status: 204, description: 'Sesiones revocadas' })
  async logoutAll(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: CookieReply,
  ): Promise<void> {
    await this.sessionService.revokeAllSessions(
      this.authenticatedActor(request),
      this.context(request),
    );
    this.authHttpService.clearRefreshCookie(reply);
  }

  private response(tokens: SessionTokenPair, identity?: AuthenticatedIdentity) {
    return {
      accessToken: tokens.accessToken,
      tokenType: 'Bearer',
      expiresIn: tokens.accessTokenExpiresIn,
      session: {
        id: tokens.sessionId,
        idleExpiresAt: tokens.idleExpiresAt,
        absoluteExpiresAt: tokens.absoluteExpiresAt,
      },
      ...(identity
        ? {
            user: {
              id: identity.userId,
              organizationId: identity.organizationId,
              email: identity.email,
              displayName: identity.displayName,
            },
          }
        : {}),
    };
  }

  private context(
    request: AuthRequest | AuthenticatedRequest,
  ): AuthenticationContext {
    const userAgent = request.headers['user-agent'];
    return {
      ipAddress: request.ip,
      userAgent:
        typeof userAgent === 'string' ? userAgent.slice(0, 1024) : undefined,
    };
  }

  private authenticatedActor(request: AuthenticatedRequest) {
    if (!request.auth) {
      throw new UnauthorizedException({
        statusCode: 401,
        code: 'AUTH_INVALID_ACCESS_TOKEN',
        message: 'Access token no valido',
      });
    }
    return request.auth;
  }

  private rethrow(error: unknown): never {
    if (error instanceof ZodError) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        message: 'Datos de entrada invalidos',
      });
    }
    if (error instanceof CsrfValidationError) {
      throw new ForbiddenException({
        statusCode: 403,
        code: error.code,
        message: error.message,
      });
    }
    if (
      error instanceof AuthenticationError ||
      error instanceof RefreshTokenError
    ) {
      throw new UnauthorizedException({
        statusCode: 401,
        code: 'AUTH_INVALID_CREDENTIALS',
        message: 'Credenciales o sesion no validas',
      });
    }
    if (error instanceof SessionOperationError) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: error.code,
        message: error.message,
      });
    }
    throw error;
  }
}
