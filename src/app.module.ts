import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { AuthorizationModule } from './authorization/authorization.module';
import { BootstrapAdminModule } from './bootstrap-admin/bootstrap-admin.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { AuditModule } from './observability/audit.module';
import { ObservabilityModule } from './observability/observability.module';

@Module({
  imports: [
    AuthModule,
    AuthorizationModule,
    BootstrapAdminModule,
    DatabaseModule,
    HealthModule,
    ObservabilityModule,
    AuditModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
