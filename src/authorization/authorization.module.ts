import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthorizationRepository } from './authorization.repository';
import { AuthorizationService } from './authorization.service';
import { ImportAuthorizationRepository } from './import-authorization.repository';
import { ImportAuthorizationService } from './import-authorization.service';
import { ImportAuthorizationController } from './import-authorization.controller';
import { PermissionsGuard } from './permissions.guard';
import { AuthenticatedContextRepository } from './authenticated-context.repository';
import { AuthenticatedContextService } from './authenticated-context.service';
import { AuthenticatedContextController } from './authenticated-context.controller';

@Module({
  imports: [AuthModule],
  controllers: [ImportAuthorizationController, AuthenticatedContextController],
  providers: [
    AuthorizationRepository,
    AuthorizationService,
    ImportAuthorizationRepository,
    ImportAuthorizationService,
    PermissionsGuard,
    AuthenticatedContextRepository,
    AuthenticatedContextService,
  ],
  exports: [
    AuthorizationService,
    ImportAuthorizationService,
    PermissionsGuard,
    AuthenticatedContextService,
  ],
})
export class AuthorizationModule {}
