import { Global, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { GlobalExceptionFilter } from './global-exception.filter';
import { RequestContextService } from './request-context.service';

@Global()
@Module({
  providers: [
    RequestContextService,
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
  exports: [RequestContextService],
})
export class ObservabilityModule {}
