export const AUTH_SECURITY_OPTIONS = Symbol('AUTH_SECURITY_OPTIONS');

export interface AuthSecurityOptions {
  maxFailedAttempts: number;
  lockoutMinutes: number;
}
