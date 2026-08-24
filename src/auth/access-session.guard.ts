import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { SessionRepository } from './session.repository';
import { TokenService, type VerifiedAccessToken } from './token.service';

export interface AuthenticatedRequest {
  ip: string;
  headers: Record<string, string | string[] | undefined>;
  auth?: VerifiedAccessToken;
}

@Injectable()
export class AccessSessionGuard implements CanActivate {
  constructor(
    @Inject(TokenService) private readonly tokenService: TokenService,
    @Inject(SessionRepository)
    private readonly sessionRepository: SessionRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    let claims: VerifiedAccessToken;
    try {
      const token = this.readBearerToken(request.headers.authorization);
      claims = await this.tokenService.verifyAccessToken(token);
    } catch {
      this.throwUnauthorized();
    }

    let active: boolean;
    try {
      active = await this.sessionRepository.isAccessSessionActive(claims);
    } catch {
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'AUTH_SESSION_VALIDATION_UNAVAILABLE',
        message: 'No fue posible validar la sesion',
      });
    }
    if (!active) this.throwUnauthorized();

    request.auth = claims;
    return true;
  }

  private readBearerToken(value: string | string[] | undefined): string {
    if (typeof value !== 'string') throw new Error('missing');
    const match = /^Bearer ([^\s]+)$/.exec(value);
    if (!match?.[1]) throw new Error('invalid');
    return match[1];
  }

  private throwUnauthorized(): never {
    throw new UnauthorizedException({
      statusCode: 401,
      code: 'AUTH_INVALID_ACCESS_TOKEN',
      message: 'Access token no valido',
    });
  }
}
