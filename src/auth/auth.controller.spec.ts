import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import type { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import {
  AuthenticationError,
  type AuthenticationFailureReason,
} from './errors/authentication.error';

const request = {
  ip: '127.0.0.1',
  headers: { 'user-agent': 'x'.repeat(2048) },
};

describe('AuthController', () => {
  it.each<AuthenticationFailureReason>([
    'invalid_credentials',
    'account_inactive',
    'account_locked',
    'membership_inactive',
    'organization_required',
  ])('returns the same external response for %s', async (reason) => {
    const login = vi.fn().mockRejectedValue(new AuthenticationError(reason));
    const controller = new AuthController({ login } as unknown as AuthService);

    const error = await controller
      .login({ email: 'admin@dirego.test', password: 'Password1!' }, request)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).getResponse()).toEqual({
      statusCode: 401,
      code: 'AUTH_INVALID_CREDENTIALS',
      message: 'Credenciales no validas',
    });
  });

  it('returns a controlled bad request without echoing invalid input', async () => {
    const login = vi.fn().mockRejectedValue(new ZodError([]));
    const controller = new AuthController({ login } as unknown as AuthService);

    const error = await controller
      .login({ email: 'invalid', password: 'secret' }, request)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toEqual({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Datos de entrada invalidos',
    });
  });

  it('limits User-Agent before passing context to the service', async () => {
    const login = vi.fn().mockResolvedValue({ userId: 'user-id' });
    const controller = new AuthController({ login } as unknown as AuthService);

    await controller.login(
      { email: 'admin@dirego.test', password: 'Password1!' },
      request,
    );

    expect(login).toHaveBeenCalledWith(expect.anything(), {
      ipAddress: '127.0.0.1',
      userAgent: 'x'.repeat(1024),
    });
  });
});
