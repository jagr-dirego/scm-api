export class CsrfValidationError extends Error {
  readonly code = 'AUTH_CSRF_VALIDATION_FAILED';

  constructor() {
    super('No fue posible validar el origen de la solicitud');
    this.name = 'CsrfValidationError';
  }
}
