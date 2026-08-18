export const AUTH_SECURITY_OPTIONS = Symbol('AUTH_SECURITY_OPTIONS');

export interface AuthSecurityOptions {
  maxFailedAttempts: number;
  lockoutMinutes: number;
}

export const AUTH_HTTP_OPTIONS = Symbol('AUTH_HTTP_OPTIONS');

export interface AuthHttpOptions {
  trustedOrigins: string[];
}
