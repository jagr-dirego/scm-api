export type AuthenticationFailureReason =
  | 'invalid_credentials'
  | 'account_inactive'
  | 'account_locked'
  | 'membership_inactive'
  | 'organization_required';

export class AuthenticationError extends Error {
  readonly code = 'AUTH_INVALID_CREDENTIALS';

  constructor(readonly reason: AuthenticationFailureReason) {
    super('Credenciales no validas');
    this.name = 'AuthenticationError';
  }
}
