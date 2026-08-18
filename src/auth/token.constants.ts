export const TOKEN_OPTIONS = Symbol('TOKEN_OPTIONS');

export interface TokenOptions {
  issuer: string;
  audience: string;
  accessTtlSeconds: number;
  signingKeyId: string;
  privateKeyPem: string;
  publicKeysPem: Record<string, string>;
  sessionIdleTtlSeconds: number;
  sessionAbsoluteTtlSeconds: number;
  refreshCookieName: string;
  refreshCookieSecure: boolean;
}
