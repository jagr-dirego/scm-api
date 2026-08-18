import { appConfig } from '../config/app.config';
import { NestStructuredLogger } from './nest-structured-logger';
import { createStructuredLogger } from './structured-logger';

export const applicationLogger = createStructuredLogger(
  appConfig.logLevel,
  appConfig.nodeEnv,
);

export const applicationNestLogger = new NestStructuredLogger(
  applicationLogger,
  appConfig.nodeEnv,
);
