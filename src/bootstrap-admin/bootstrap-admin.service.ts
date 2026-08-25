import { Inject, Injectable } from '@nestjs/common';
import { PasswordService } from '../auth/password.service';
import {
  BootstrapAdminRepository,
  type BootstrapResult,
} from './bootstrap-admin.repository';
import {
  bootstrapInputSchema,
  type BootstrapInput,
} from './schemas/bootstrap-input.schema';

@Injectable()
export class BootstrapAdminService {
  constructor(
    @Inject(PasswordService)
    private readonly passwordService: PasswordService,
    @Inject(BootstrapAdminRepository)
    private readonly repository: BootstrapAdminRepository,
  ) {}

  async execute(input: BootstrapInput): Promise<BootstrapResult> {
    const validatedInput = bootstrapInputSchema.parse(input);
    const passwordHash = await this.passwordService.hash(
      validatedInput.password,
    );

    return this.repository.execute(validatedInput, passwordHash);
  }
}
