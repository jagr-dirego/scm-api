import type { ImportQueueJob } from '../dispatcher.contracts';

export const IMPORT_QUEUE_PUBLISHER_PORT = Symbol(
  'IMPORT_QUEUE_PUBLISHER_PORT',
);

export interface ImportQueuePublisherPort {
  publish(job: ImportQueueJob): Promise<void>;
}
