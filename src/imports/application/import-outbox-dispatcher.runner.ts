import { Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ImportOutboxDispatcherService } from './import-outbox-dispatcher.service';

export class ImportOutboxDispatcherRunner implements OnApplicationBootstrap {
  private readonly logger = new Logger(ImportOutboxDispatcherRunner.name);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private activeRun: Promise<void> | undefined;
  private running = false;

  constructor(
    private readonly dispatcher: ImportOutboxDispatcherService,
    private readonly pollMs: number,
  ) {
    if (pollMs <= 0) {
      throw new Error(
        'Import outbox dispatcher poll interval must be positive',
      );
    }
  }

  onApplicationBootstrap(): void {
    this.start();
  }

  start(): void {
    if (this.running) return;

    this.running = true;
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.activeRun;
  }

  private schedule(delayMs: number): void {
    if (!this.running) return;

    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.activeRun = this.runOnce();
    }, delayMs);
  }

  private async runOnce(): Promise<void> {
    try {
      await this.dispatcher.dispatchOnce();
    } catch {
      this.logger.error('Import outbox dispatch cycle failed');
    } finally {
      this.schedule(this.pollMs);
    }
  }
}
