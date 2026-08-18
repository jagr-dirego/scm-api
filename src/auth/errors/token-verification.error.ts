export class TokenVerificationError extends Error {
  readonly code = 'AUTH_INVALID_ACCESS_TOKEN';

  constructor() {
    super('Access token no valido');
    this.name = 'TokenVerificationError';
  }
}
