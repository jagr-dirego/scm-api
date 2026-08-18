import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuditRepository } from './audit.repository';
import { AuditService } from './audit.service';
import { ObservabilityModule } from './observability.module';

@Module({
  imports: [DatabaseModule, ObservabilityModule],
  providers: [AuditRepository, AuditService],
  exports: [AuditService],
})
export class AuditModule {}
