import { describe, expect, it, vi } from 'vitest';
import type {
  AuthMembershipRecord,
  AuthRepository,
  AuthUserRecord,
  AuthenticatedIdentity,
} from './auth.repository';
import { AuthService } from './auth.service';
import { AuthenticationError } from './errors/authentication.error';
import type { PasswordService } from './password.service';

const membership: AuthMembershipRecord = {
  id: 'membership-id',
  status: 'active',
  organizationId: 'organization-id',
  organizationCode: 'DIREGO',
  organizationStatus: 'active',
};

const user: AuthUserRecord = {
  id: 'user-id',
  email: 'admin@dirego.test',
  displayName: 'Administrador',
  passwordHash: '$argon2id$hash',
  status: 'active',
  failedLoginCount: 0,
  lockedUntil: null,
  memberships: [membership],
};

const identity: AuthenticatedIdentity = {
  userId: user.id,
  organizationId: membership.organizationId,
  membershipId: membership.id,
  email: user.email,
  displayName: user.displayName,
};

const createDependencies = () => {
  const repository = {
    findByEmail: vi.fn().mockResolvedValue(user),
    recordAnonymousFailure: vi.fn().mockResolvedValue(undefined),
    recordKnownFailure: vi.fn().mockResolvedValue(undefined),
    confirmSuccess: vi.fn().mockResolvedValue(identity),
  };
  const passwordService = {
    verify: vi.fn().mockResolvedValue(true),
    verifyDummy: vi.fn().mockResolvedValue(undefined),
    needsRehash: vi.fn().mockReturnValue(false),
    hash: vi.fn().mockResolvedValue('$argon2id$new-hash'),
  };
  return {
    repository,
    passwordService,
    service: new AuthService(
      repository as unknown as AuthRepository,
      passwordService as unknown as PasswordService,
    ),
  };
};

const loginInput = { email: ' ADMIN@DIREGO.TEST ', password: 'Password1!' };
const context = { ipAddress: '127.0.0.1', userAgent: 'vitest' };

describe('AuthService', () => {
  it('authenticates one active membership and confirms success', async () => {
    const { service, repository } = createDependencies();

    await expect(service.login(loginInput, context)).resolves.toEqual(identity);

    expect(repository.findByEmail).toHaveBeenCalledWith('admin@dirego.test');
    expect(repository.confirmSuccess).toHaveBeenCalledWith(
      user,
      membership,
      null,
      context,
    );
  });

  it('uses a dummy hash and records an anonymous event for an unknown email', async () => {
    const { service, repository, passwordService } = createDependencies();
    repository.findByEmail.mockResolvedValue(null);

    await expect(service.login(loginInput, context)).rejects.toMatchObject({
      code: 'AUTH_INVALID_CREDENTIALS',
      reason: 'invalid_credentials',
    });
    expect(passwordService.verifyDummy).toHaveBeenCalledWith('Password1!');
    expect(repository.recordAnonymousFailure).toHaveBeenCalledWith(
      'admin@dirego.test',
      'invalid_credentials',
      context,
    );
  });

  it('increments attempts for an invalid password without confirming success', async () => {
    const { service, repository, passwordService } = createDependencies();
    passwordService.verify.mockResolvedValue(false);

    await expect(service.login(loginInput, context)).rejects.toBeInstanceOf(
      AuthenticationError,
    );
    expect(repository.recordKnownFailure).toHaveBeenCalledWith(
      user,
      membership.organizationId,
      'invalid_credentials',
      true,
      context,
    );
    expect(repository.confirmSuccess).not.toHaveBeenCalled();
  });

  it('records a locked account without extending its failed attempt count', async () => {
    const { service, repository, passwordService } = createDependencies();
    passwordService.verify.mockResolvedValue(false);
    repository.findByEmail.mockResolvedValue({
      ...user,
      lockedUntil: new Date(Date.now() + 60_000),
    });

    await expect(service.login(loginInput, context)).rejects.toMatchObject({
      reason: 'account_locked',
    });
    expect(repository.recordKnownFailure).toHaveBeenCalledWith(
      expect.anything(),
      membership.organizationId,
      'account_locked',
      false,
      context,
    );
  });

  it('requires an organization code when multiple memberships are active', async () => {
    const { service, repository } = createDependencies();
    repository.findByEmail.mockResolvedValue({
      ...user,
      memberships: [
        membership,
        {
          ...membership,
          id: 'membership-2',
          organizationId: 'organization-2',
          organizationCode: 'SECOND',
        },
      ],
    });

    await expect(service.login(loginInput, context)).rejects.toMatchObject({
      reason: 'organization_required',
    });
  });

  it('selects an explicitly requested active organization', async () => {
    const { service, repository } = createDependencies();
    const second = {
      ...membership,
      id: 'membership-2',
      organizationId: 'organization-2',
      organizationCode: 'SECOND',
    };
    const multiOrganizationUser = {
      ...user,
      memberships: [membership, second],
    };
    repository.findByEmail.mockResolvedValue(multiOrganizationUser);
    repository.confirmSuccess.mockResolvedValue({
      ...identity,
      organizationId: second.organizationId,
    });

    await service.login(
      { ...loginInput, organizationCode: ' second ' },
      context,
    );

    expect(repository.confirmSuccess).toHaveBeenCalledWith(
      multiOrganizationUser,
      second,
      null,
      context,
    );
  });

  it('rehashes a valid password when its stored costs are obsolete', async () => {
    const { service, repository, passwordService } = createDependencies();
    passwordService.needsRehash.mockReturnValue(true);

    await service.login(loginInput, context);

    expect(passwordService.hash).toHaveBeenCalledWith('Password1!');
    expect(repository.confirmSuccess).toHaveBeenCalledWith(
      user,
      membership,
      '$argon2id$new-hash',
      context,
    );
  });

  it('records a controlled failure when eligibility changes before commit', async () => {
    const { service, repository } = createDependencies();
    repository.confirmSuccess.mockResolvedValue(null);

    await expect(service.login(loginInput, context)).rejects.toMatchObject({
      reason: 'invalid_credentials',
    });
    expect(repository.recordKnownFailure).toHaveBeenCalledWith(
      user,
      membership.organizationId,
      'invalid_credentials',
      false,
      context,
    );
  });
});
