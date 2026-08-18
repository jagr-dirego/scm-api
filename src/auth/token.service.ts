import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  SignJWT,
  importPKCS8,
  importSPKI,
  jwtVerify,
  type JWTPayload,
} from 'jose';
import { z } from 'zod';
import { TOKEN_OPTIONS, type TokenOptions } from './token.constants';
import { TokenVerificationError } from './errors/token-verification.error';

const accessClaimsSchema = z.object({
  sub: z.string().uuid(),
  sid: z.string().uuid(),
  oid: z.string().uuid(),
  jti: z.string().uuid(),
  iat: z.number().int(),
  exp: z.number().int(),
  iss: z.string(),
  aud: z.union([z.string(), z.array(z.string())]),
});

const accessTokenInputSchema = z.object({
  userId: z.string().uuid(),
  sessionId: z.string().uuid(),
  organizationId: z.string().uuid(),
});

export interface AccessTokenInput {
  userId: string;
  sessionId: string;
  organizationId: string;
}

export interface VerifiedAccessToken {
  userId: string;
  sessionId: string;
  organizationId: string;
  tokenId: string;
  issuedAt: number;
  expiresAt: number;
}

@Injectable()
export class TokenService implements OnModuleInit {
  private readonly privateKey: ReturnType<typeof importPKCS8>;
  private readonly publicKeys: Map<string, ReturnType<typeof importSPKI>>;

  constructor(@Inject(TOKEN_OPTIONS) private readonly options: TokenOptions) {
    this.privateKey = importPKCS8(options.privateKeyPem, 'RS256');
    this.publicKeys = new Map(
      Object.entries(options.publicKeysPem).map(([keyId, pem]) => [
        keyId,
        importSPKI(pem, 'RS256'),
      ]),
    );
  }

  async onModuleInit(): Promise<void> {
    const probe = await this.signAccessToken({
      userId: randomUUID(),
      sessionId: randomUUID(),
      organizationId: randomUUID(),
    });
    await this.verifyAccessToken(probe);
  }

  async signAccessToken(input: AccessTokenInput): Promise<string> {
    const validatedInput = accessTokenInputSchema.parse(input);
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({
      sid: validatedInput.sessionId,
      oid: validatedInput.organizationId,
    })
      .setProtectedHeader({
        alg: 'RS256',
        kid: this.options.signingKeyId,
        typ: 'JWT',
      })
      .setIssuer(this.options.issuer)
      .setAudience(this.options.audience)
      .setSubject(validatedInput.userId)
      .setJti(randomUUID())
      .setIssuedAt(now)
      .setExpirationTime(now + this.options.accessTtlSeconds)
      .sign(await this.privateKey);
  }

  async verifyAccessToken(token: string): Promise<VerifiedAccessToken> {
    try {
      if (!token || token.length > 4096) {
        throw new TokenVerificationError();
      }
      const result = await jwtVerify(
        token,
        async (protectedHeader) => {
          if (protectedHeader.alg !== 'RS256' || !protectedHeader.kid) {
            throw new TokenVerificationError();
          }
          const key = this.publicKeys.get(protectedHeader.kid);
          if (!key) {
            throw new TokenVerificationError();
          }
          return key;
        },
        {
          algorithms: ['RS256'],
          issuer: this.options.issuer,
          audience: this.options.audience,
          typ: 'JWT',
          requiredClaims: ['sub', 'sid', 'oid', 'jti', 'iat', 'exp'],
        },
      );
      return this.readClaims(result.payload);
    } catch {
      throw new TokenVerificationError();
    }
  }

  generateRefreshToken(): string {
    return randomBytes(32).toString('base64url');
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('base64url');
  }

  private readClaims(payload: JWTPayload): VerifiedAccessToken {
    const claims = accessClaimsSchema.parse(payload);
    return {
      userId: claims.sub,
      sessionId: claims.sid,
      organizationId: claims.oid,
      tokenId: claims.jti,
      issuedAt: claims.iat,
      expiresAt: claims.exp,
    };
  }
}
