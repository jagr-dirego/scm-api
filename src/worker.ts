import { parseEnvironment } from './config/environment.schema';
import { NestStructuredLogger } from './observability/nest-structured-logger';
import { createStructuredLogger } from './observability/structured-logger';
import { bootstrapWorker } from './worker-bootstrap';

const environment = parseEnvironment(process.env);
const workerLogger = new NestStructuredLogger(
  createStructuredLogger(environment.LOG_LEVEL, environment.NODE_ENV).child({
    processRole: 'worker',
  }),
  environment.NODE_ENV,
);

void bootstrapWorker(workerLogger).catch(() => {
  workerLogger.error('Worker bootstrap failed');
  process.exitCode = 1;
});
