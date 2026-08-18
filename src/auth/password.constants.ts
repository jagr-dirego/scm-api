export const PASSWORD_HASH_OPTIONS = Symbol('PASSWORD_HASH_OPTIONS');

export interface PasswordHashOptions {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
  hashLength: number;
}
