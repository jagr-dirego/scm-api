import { Inject, Injectable } from '@nestjs/common';
import { BootstrapAdminService } from './bootstrap-admin.service';

export interface BootstrapAdminPrompt {
  ask(label: string): Promise<string>;
  askSecret(label: string): Promise<string>;
}

export class BootstrapCommandCancelledError extends Error {
  readonly code = 'BOOTSTRAP_CANCELLED';

  constructor(message = 'Bootstrap cancelado') {
    super(message);
    this.name = 'BootstrapCommandCancelledError';
  }
}

@Injectable()
export class BootstrapAdminCommandRunner {
  constructor(
    @Inject(BootstrapAdminService)
    private readonly bootstrapAdminService: BootstrapAdminService,
  ) {}

  async run(prompt: BootstrapAdminPrompt): Promise<void> {
    const organizationCode = await prompt.ask('Codigo de organizacion: ');
    const organizationName = await prompt.ask('Nombre de organizacion: ');
    const organizationSlug = await prompt.ask('Slug de organizacion: ');
    const email = await prompt.ask('Email del SuperAdmin: ');
    const displayName = await prompt.ask('Nombre visible del SuperAdmin: ');
    const password = await prompt.askSecret('Password: ');
    const passwordConfirmation = await prompt.askSecret('Confirmar password: ');

    if (password !== passwordConfirmation) {
      throw new BootstrapCommandCancelledError('Los passwords no coinciden');
    }

    const confirmation = await prompt.ask('Escriba CREAR para confirmar: ');
    if (confirmation !== 'CREAR') {
      throw new BootstrapCommandCancelledError();
    }

    await this.bootstrapAdminService.execute({
      organizationCode,
      organizationName,
      organizationSlug,
      email,
      displayName,
      password,
    });
  }
}
