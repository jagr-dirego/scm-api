import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BootstrapAdminRepository } from './bootstrap-admin.repository';
import { BootstrapAdminCommandRunner } from './bootstrap-admin.command-runner';
import { BootstrapAdminService } from './bootstrap-admin.service';

@Module({
  imports: [AuthModule],
  providers: [
    BootstrapAdminCommandRunner,
    BootstrapAdminRepository,
    BootstrapAdminService,
  ],
  exports: [BootstrapAdminCommandRunner, BootstrapAdminService],
})
export class BootstrapAdminModule {}
