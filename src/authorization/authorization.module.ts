import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationRepository } from './authorization.repository';
import { AuthorizationService } from './authorization.service';
import { ImportAuthorizationRepository } from './import-authorization.repository';
import { ImportAuthorizationService } from './import-authorization.service';
import { ImportAuthorizationController } from './import-authorization.controller';
import { PermissionsGuard } from './permissions.guard';

@Module({
  imports: [AuthModule],
  controllers: [ImportAuthorizationController],
  providers: [
    AuthorizationRepository,
    AuthorizationService,
    ImportAuthorizationRepository,
    ImportAuthorizationService,
    PermissionsGuard,
  ],
  exports: [AuthorizationService, ImportAuthorizationService, PermissionsGuard],
})
export class AuthorizationModule {}
