import type { LoggerService } from '@nestjs/common';
import type { Logger } from 'pino';
import { requestContextStorage } from './request-context.storage';

type LogLevel = 'debug' | 'error' | 'fatal' | 'info' | 'trace' | 'warn';

export class NestStructuredLogger implements LoggerService {
  constructor(
    private readonly logger: Logger,
    private readonly environment: string,
  ) {}

  log(message: unknown, context?: string): void {
    this.write('info', message, context);
  }

  error(message: unknown, stack?: string, context?: string): void {
    this.write('error', message, context, stack);
  }

  warn(message: unknown, context?: string): void {
    this.write('warn', message, context);
  }

  debug(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.write('trace', message, context);
  }

  fatal(message: unknown, context?: string): void {
    this.write('fatal', message, context);
  }

  private write(
    level: LogLevel,
    message: unknown,
    context?: string,
    stack?: string,
  ): void {
    const text =
      typeof message === 'string' ? message : 'Nest application event';
    const fields = {
      ...(context ? { context } : {}),
      ...(requestContextStorage.getStore()?.requestId
        ? { requestId: requestContextStorage.getStore()?.requestId }
        : {}),
      ...(typeof message === 'object' && message !== null
        ? { data: message }
        : {}),
      ...(stack && this.environment !== 'production' ? { stack } : {}),
    };
    this.logger[level](fields, text);
  }
}
