import { describe, expect, it } from 'vitest';
import { loginSchema } from './login.schema';

describe('loginSchema', () => {
  it('normalizes email and organization code without changing the password', () => {
    expect(
      loginSchema.parse({
        email: ' Admin@Dirego.test ',
        password: ' Password With Spaces ',
        organizationCode: ' dirego ',
      }),
    ).toEqual({
      email: 'admin@dirego.test',
      password: ' Password With Spaces ',
      organizationCode: 'DIREGO',
    });
  });

  it.each([
    { email: 'invalid', password: 'Password1!' },
    { email: 'admin@dirego.test', password: '' },
    { email: 'admin@dirego.test', password: 'x'.repeat(129) },
    {
      email: 'admin@dirego.test',
      password: 'Password1!',
      organizationCode: '',
    },
  ])('rejects invalid login input', (input) => {
    expect(loginSchema.safeParse(input).success).toBe(false);
  });
});
