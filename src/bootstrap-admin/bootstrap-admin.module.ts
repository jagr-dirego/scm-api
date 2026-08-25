import { Module } from '@nestjs/common';
import { appConfig } from '../config/app.config';
import { DatabaseModule } from '../database/database.module';
import { PASSWORD_HASH_OPTIONS } from '../auth/password.constants';
import { PasswordService } from '../auth/password.service';
import { BootstrapAdminRepository } from './bootstrap-admin.repository';
import { BootstrapAdminCommandRunner } from './bootstrap-admin.command-runner';
import { BootstrapAdminService } from './bootstrap-admin.service';

@Module({
  imports: [DatabaseModule],
  providers: [
    { provide: PASSWORD_HASH_OPTIONS, useValue: appConfig.argon2 },
    PasswordService,
    BootstrapAdminCommandRunner,
    BootstrapAdminRepository,
    BootstrapAdminService,
  ],
  exports: [BootstrapAdminCommandRunner, BootstrapAdminService],
})
export class BootstrapAdminModule {}
