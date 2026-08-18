import { describe, expect, it, vi } from 'vitest';
import type { PasswordService } from '../auth/password.service';
import type {
  BootstrapAdminRepository,
  BootstrapResult,
} from './bootstrap-admin.repository';
import { BootstrapAdminService } from './bootstrap-admin.service';

const input = {
  organizationCode: ' drg_test ',
  organizationName: ' DIREGO Test ',
  organizationSlug: 'dirego-test',
  email: ' ADMIN@EXAMPLE.COM ',
  displayName: ' Administrador Inicial ',
  password: 'a-secure-test-password',
};
const result: BootstrapResult = {
  organizationId: '10000000-0000-4000-8000-000000000001',
  userId: '20000000-0000-4000-8000-000000000001',
  membershipId: '30000000-0000-4000-8000-000000000001',
  roleAssignmentId: '40000000-0000-4000-8000-000000000001',
};

describe('BootstrapAdminService', () => {
  it('hashes before sending normalized data to the repository', async () => {
    const hash = vi.fn().mockResolvedValue('encoded-password-hash');
    const execute = vi.fn().mockResolvedValue(result);
    const service = new BootstrapAdminService(
      { hash } as unknown as PasswordService,
      { execute } as unknown as BootstrapAdminRepository,
    );

    await expect(service.execute(input)).resolves.toEqual(result);
    expect(hash).toHaveBeenCalledWith(input.password);
    expect(execute).toHaveBeenCalledWith(
      {
        organizationCode: 'DRG_TEST',
        organizationName: 'DIREGO Test',
        organizationSlug: 'dirego-test',
        email: 'admin@example.com',
        displayName: 'Administrador Inicial',
        password: input.password,
      },
      'encoded-password-hash',
    );
  });

  it.each([
    { ...input, password: 'too-short' },
    { ...input, email: 'invalid-email' },
    { ...input, organizationCode: 'invalid code' },
    { ...input, organizationSlug: 'Invalid Slug' },
  ])('rejects invalid input before hashing', async (invalidInput) => {
    const hash = vi.fn();
    const execute = vi.fn();
    const service = new BootstrapAdminService(
      { hash } as unknown as PasswordService,
      { execute } as unknown as BootstrapAdminRepository,
    );

    await expect(service.execute(invalidInput)).rejects.toBeDefined();
    expect(hash).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});
