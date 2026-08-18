import { describe, expect, it, vi } from 'vitest';
import type { BootstrapAdminService } from './bootstrap-admin.service';
import {
  BootstrapAdminCommandRunner,
  BootstrapCommandCancelledError,
  type BootstrapAdminPrompt,
} from './bootstrap-admin.command-runner';

const answers = [
  'dirego',
  'Dirego',
  'dirego',
  'admin@dirego.test',
  'Administrador',
];

const createPrompt = (
  secrets: string[],
  confirmation = 'CREAR',
): BootstrapAdminPrompt => ({
  ask: vi
    .fn()
    .mockResolvedValueOnce(answers[0])
    .mockResolvedValueOnce(answers[1])
    .mockResolvedValueOnce(answers[2])
    .mockResolvedValueOnce(answers[3])
    .mockResolvedValueOnce(answers[4])
    .mockResolvedValueOnce(confirmation),
  askSecret: vi
    .fn()
    .mockResolvedValueOnce(secrets[0])
    .mockResolvedValueOnce(secrets[1]),
});

describe('BootstrapAdminCommandRunner', () => {
  it('sends confirmed interactive input to the bootstrap service', async () => {
    const execute = vi.fn().mockResolvedValue({});
    const runner = new BootstrapAdminCommandRunner({
      execute,
    } as unknown as BootstrapAdminService);

    await runner.run(createPrompt(['StrongPassword1!', 'StrongPassword1!']));

    expect(execute).toHaveBeenCalledWith({
      organizationCode: 'dirego',
      organizationName: 'Dirego',
      organizationSlug: 'dirego',
      email: 'admin@dirego.test',
      displayName: 'Administrador',
      password: 'StrongPassword1!',
    });
  });

  it('rejects different passwords before calling the service', async () => {
    const execute = vi.fn();
    const runner = new BootstrapAdminCommandRunner({
      execute,
    } as unknown as BootstrapAdminService);

    await expect(
      runner.run(createPrompt(['StrongPassword1!', 'DifferentPassword1!'])),
    ).rejects.toBeInstanceOf(BootstrapCommandCancelledError);
    expect(execute).not.toHaveBeenCalled();
  });

  it('requires the explicit CREAR confirmation', async () => {
    const execute = vi.fn();
    const runner = new BootstrapAdminCommandRunner({
      execute,
    } as unknown as BootstrapAdminService);

    await expect(
      runner.run(createPrompt(['StrongPassword1!', 'StrongPassword1!'], 'NO')),
    ).rejects.toBeInstanceOf(BootstrapCommandCancelledError);
    expect(execute).not.toHaveBeenCalled();
  });
});
