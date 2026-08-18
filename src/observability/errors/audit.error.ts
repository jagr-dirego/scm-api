export class AuditValidationError extends Error {
  constructor() {
    super('Audit event does not satisfy an approved contract');
    this.name = 'AuditValidationError';
  }
}

export class AuditContextError extends Error {
  constructor() {
    super('Audit event requires an active request context');
    this.name = 'AuditContextError';
  }
}
