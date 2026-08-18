import { Injectable } from '@nestjs/common';
import {
  AuthRepository,
  type AuthMembershipRecord,
  type AuthenticatedIdentity,
  type AuthenticationContext,
} from './auth.repository';
import {
  AuthenticationError,
  type AuthenticationFailureReason,
} from './errors/authentication.error';
import { PasswordService } from './password.service';
import { loginSchema, type LoginInput } from './schemas/login.schema';

@Injectable()
export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly passwordService: PasswordService,
  ) {}

  async login(
    input: LoginInput,
    context: AuthenticationContext,
  ): Promise<AuthenticatedIdentity> {
    const validated = loginSchema.parse(input);
    const user = await this.repository.findByEmail(validated.email);

    if (!user) {
      await this.passwordService.verifyDummy(validated.password);
      await this.repository.recordAnonymousFailure(
        validated.email,
        'invalid_credentials',
        context,
      );
      throw new AuthenticationError('invalid_credentials');
    }

    const passwordValid = await this.passwordService.verify(
      user.passwordHash,
      validated.password,
    );
    const memberships = user.memberships.filter(
      (membership) =>
        membership.status === 'active' &&
        membership.organizationStatus === 'active',
    );
    const membership = this.selectMembership(
      memberships,
      validated.organizationCode,
    );
    const failure = this.resolveFailure(
      user.status,
      user.lockedUntil,
      passwordValid,
      membership,
      memberships.length,
      validated.organizationCode,
    );

    if (failure) {
      await this.repository.recordKnownFailure(
        user,
        membership?.organizationId ?? null,
        failure,
        failure !== 'account_locked',
        context,
      );
      throw new AuthenticationError(failure);
    }

    if (!membership) {
      throw new AuthenticationError('membership_inactive');
    }

    const replacementPasswordHash = this.passwordService.needsRehash(
      user.passwordHash,
    )
      ? await this.passwordService.hash(validated.password)
      : null;
    const identity = await this.repository.confirmSuccess(
      user,
      membership,
      replacementPasswordHash,
      context,
    );
    if (!identity) {
      await this.repository.recordKnownFailure(
        user,
        membership.organizationId,
        'invalid_credentials',
        false,
        context,
      );
      throw new AuthenticationError('invalid_credentials');
    }
    return identity;
  }

  private selectMembership(
    memberships: AuthMembershipRecord[],
    organizationCode?: string,
  ): AuthMembershipRecord | null {
    if (organizationCode) {
      return (
        memberships.find(
          (membership) => membership.organizationCode === organizationCode,
        ) ?? null
      );
    }
    return memberships.length === 1 ? memberships[0] : null;
  }

  private resolveFailure(
    userStatus: string,
    lockedUntil: Date | null,
    passwordValid: boolean,
    membership: AuthMembershipRecord | null,
    membershipCount: number,
    organizationCode?: string,
  ): AuthenticationFailureReason | null {
    if (userStatus !== 'active') return 'account_inactive';
    if (lockedUntil && lockedUntil > new Date()) return 'account_locked';
    if (!passwordValid) return 'invalid_credentials';
    if (!membership && membershipCount > 1 && !organizationCode)
      return 'organization_required';
    if (!membership) return 'membership_inactive';
    return null;
  }
}
