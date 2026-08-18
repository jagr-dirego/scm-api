export class BootstrapAlreadyCompletedError extends Error {
  readonly code = 'BOOTSTRAP_ALREADY_COMPLETED';

  constructor() {
    super('Initial administrator bootstrap has already been completed');
    this.name = 'BootstrapAlreadyCompletedError';
  }
}

export class BootstrapPrerequisiteError extends Error {
  readonly code = 'BOOTSTRAP_PREREQUISITE_FAILED';

  constructor() {
    super('Initial administrator bootstrap prerequisites are not satisfied');
    this.name = 'BootstrapPrerequisiteError';
  }
}

export class BootstrapConflictError extends Error {
  readonly code = 'BOOTSTRAP_CONFLICT';

  constructor() {
    super('Initial administrator bootstrap conflicts with existing data');
    this.name = 'BootstrapConflictError';
  }
}
