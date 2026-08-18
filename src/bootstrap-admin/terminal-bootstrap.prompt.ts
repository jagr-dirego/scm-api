import { createInterface } from 'node:readline/promises';
import type { ReadStream, WriteStream } from 'node:tty';
import type { BootstrapAdminPrompt } from './bootstrap-admin.command-runner';

export class InteractiveTerminalRequiredError extends Error {
  readonly code = 'INTERACTIVE_TERMINAL_REQUIRED';

  constructor() {
    super('Se requiere una terminal interactiva');
    this.name = 'InteractiveTerminalRequiredError';
  }
}

export class TerminalBootstrapPrompt implements BootstrapAdminPrompt {
  constructor(
    private readonly input: ReadStream = process.stdin,
    private readonly output: WriteStream = process.stdout,
  ) {
    if (!input.isTTY || !output.isTTY) {
      throw new InteractiveTerminalRequiredError();
    }
  }

  async ask(label: string): Promise<string> {
    const terminal = createInterface({
      input: this.input,
      output: this.output,
    });
    try {
      return await terminal.question(label);
    } finally {
      terminal.close();
    }
  }

  askSecret(label: string): Promise<string> {
    this.output.write(label);
    const previousRawMode = this.input.isRaw;
    this.input.setRawMode(true);
    this.input.resume();

    return new Promise((resolve, reject) => {
      let value = '';

      const cleanup = () => {
        this.input.off('data', onData);
        this.input.setRawMode(previousRawMode);
        this.output.write('\n');
      };
      const onData = (chunk: Buffer) => {
        for (const character of chunk.toString('utf8')) {
          if (character === '\u0003') {
            cleanup();
            reject(new BootstrapPromptInterruptedError());
            return;
          }
          if (character === '\r' || character === '\n') {
            cleanup();
            resolve(value);
            return;
          }
          if (character === '\u007f' || character === '\b') {
            value = value.slice(0, -1);
            continue;
          }
          if (character >= ' ') {
            value += character;
          }
        }
      };

      this.input.on('data', onData);
    });
  }
}

export class BootstrapPromptInterruptedError extends Error {
  readonly code = 'BOOTSTRAP_INTERRUPTED';

  constructor() {
    super('Bootstrap interrumpido');
    this.name = 'BootstrapPromptInterruptedError';
  }
}
