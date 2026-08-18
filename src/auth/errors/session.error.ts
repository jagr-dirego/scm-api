export class SessionOperationError extends Error {
  readonly code = 'AUTH_SESSION_OPERATION_FAILED';

  constructor() {
    super('No fue posible completar la operacion de sesion');
    this.name = 'SessionOperationError';
  }
}

export class RefreshTokenError extends Error {
  readonly code = 'AUTH_INVALID_REFRESH_TOKEN';

  constructor() {
    super('Refresh token no valido');
    this.name = 'RefreshTokenError';
  }
}
