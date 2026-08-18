import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type {
  AuthenticatedIdentity,
  AuthenticationContext,
} from './auth.repository';
import {
  RefreshTokenError,
  SessionOperationError,
} from './errors/session.error';
import { SessionRepository } from './session.repository';
import { TOKEN_OPTIONS, type TokenOptions } from './token.constants';
import { TokenService } from './token.service';
import type { VerifiedAccessToken } from './token.service';
import type { SessionSummary } from './session.repository';

const sessionIdSchema = z.string().uuid();

export interface SessionView extends SessionSummary {
  current: boolean;
}

export interface SessionTokenPair {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  sessionId: string;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly repository: SessionRepository,
    private readonly tokenService: TokenService,
    @Inject(TOKEN_OPTIONS) private readonly options: TokenOptions,
  ) {}

  async createSession(
    identity: AuthenticatedIdentity,
    context: AuthenticationContext,
    deviceName?: string,
  ): Promise<SessionTokenPair> {
    const now = new Date();
    const idleExpiresAt = this.addSeconds(
      now,
      this.options.sessionIdleTtlSeconds,
    );
    const absoluteExpiresAt = this.addSeconds(
      now,
      this.options.sessionAbsoluteTtlSeconds,
    );
    const refreshToken = this.tokenService.generateRefreshToken();
    const created = await this.repository.create({
      identity,
      refreshTokenHash: this.tokenService.hashRefreshToken(refreshToken),
      issuedAt: now,
      idleExpiresAt,
      absoluteExpiresAt,
      deviceName: deviceName?.slice(0, 200),
      context,
    });

    try {
      const accessToken = await this.tokenService.signAccessToken({
        userId: identity.userId,
        sessionId: created.sessionId,
        organizationId: identity.organizationId,
      });
      return {
        accessToken,
        accessTokenExpiresIn: this.options.accessTtlSeconds,
        refreshToken,
        sessionId: created.sessionId,
        idleExpiresAt: created.idleExpiresAt,
        absoluteExpiresAt: created.absoluteExpiresAt,
      };
    } catch {
      await this.repository.revokeAfterTokenFailure(created.sessionId);
      throw new SessionOperationError();
    }
  }

  async rotateSession(
    refreshToken: string,
    context: AuthenticationContext,
  ): Promise<SessionTokenPair> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(refreshToken)) {
      throw new RefreshTokenError();
    }
    const replacementToken = this.tokenService.generateRefreshToken();
    const rotatedAt = new Date();
    const result = await this.repository.rotate({
      presentedTokenHash: this.tokenService.hashRefreshToken(refreshToken),
      replacementTokenHash:
        this.tokenService.hashRefreshToken(replacementToken),
      rotatedAt,
      proposedIdleExpiresAt: this.addSeconds(
        rotatedAt,
        this.options.sessionIdleTtlSeconds,
      ),
      context,
    });
    if (result.status !== 'rotated') {
      throw new RefreshTokenError();
    }

    try {
      const accessToken = await this.tokenService.signAccessToken({
        userId: result.userId,
        sessionId: result.sessionId,
        organizationId: result.organizationId,
      });
      return {
        accessToken,
        accessTokenExpiresIn: this.options.accessTtlSeconds,
        refreshToken: replacementToken,
        sessionId: result.sessionId,
        idleExpiresAt: result.idleExpiresAt,
        absoluteExpiresAt: result.absoluteExpiresAt,
      };
    } catch {
      await this.repository.revokeAfterTokenFailure(result.sessionId);
      throw new SessionOperationError();
    }
  }

  async revokeSession(
    refreshToken: string,
    context: AuthenticationContext,
  ): Promise<void> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(refreshToken)) {
      throw new RefreshTokenError();
    }
    const revoked = await this.repository.revokeByRefreshToken(
      this.tokenService.hashRefreshToken(refreshToken),
      context,
    );
    if (!revoked) throw new RefreshTokenError();
  }

  async listSessions(actor: VerifiedAccessToken): Promise<SessionView[]> {
    const sessions = await this.repository.listActive(
      actor.userId,
      actor.organizationId,
    );
    return sessions.map((session) => ({
      ...session,
      current: session.id === actor.sessionId,
    }));
  }

  async revokeOwnedSession(
    actor: VerifiedAccessToken,
    targetSessionId: string,
    context: AuthenticationContext,
  ): Promise<void> {
    await this.repository.revokeOwned(
      actor,
      sessionIdSchema.parse(targetSessionId),
      context,
    );
  }

  async revokeAllSessions(
    actor: VerifiedAccessToken,
    context: AuthenticationContext,
  ): Promise<void> {
    await this.repository.revokeAllOwned(actor, context);
  }

  private addSeconds(date: Date, seconds: number): Date {
    return new Date(date.getTime() + seconds * 1000);
  }
}
