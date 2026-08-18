import { EventEmitter } from 'node:events';
import type { ReadStream, WriteStream } from 'node:tty';
import { describe, expect, it, vi } from 'vitest';
import {
  BootstrapPromptInterruptedError,
  TerminalBootstrapPrompt,
} from './terminal-bootstrap.prompt';

const createTerminal = () => {
  const input = new EventEmitter() as EventEmitter & {
    isTTY: boolean;
    isRaw: boolean;
    setRawMode: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
  };
  input.isTTY = true;
  input.isRaw = false;
  input.setRawMode = vi.fn((enabled: boolean) => {
    input.isRaw = enabled;
    return input;
  });
  input.resume = vi.fn(() => input);

  const writes: string[] = [];
  const output = {
    isTTY: true,
    write: vi.fn((value: string) => {
      writes.push(value);
      return true;
    }),
  };

  return {
    input: input as unknown as ReadStream,
    output: output as unknown as WriteStream,
    rawInput: input,
    writes,
  };
};

describe('TerminalBootstrapPrompt', () => {
  it('captures a secret without writing its characters and restores terminal mode', async () => {
    const terminal = createTerminal();
    const prompt = new TerminalBootstrapPrompt(terminal.input, terminal.output);
    const secret = prompt.askSecret('Password: ');

    terminal.rawInput.emit('data', Buffer.from('NeverPrinted1!\r'));

    await expect(secret).resolves.toBe('NeverPrinted1!');
    expect(terminal.writes.join('')).toBe('Password: \n');
    expect(terminal.rawInput.setRawMode).toHaveBeenNthCalledWith(1, true);
    expect(terminal.rawInput.setRawMode).toHaveBeenNthCalledWith(2, false);
  });

  it('restores terminal mode when the user interrupts with Ctrl+C', async () => {
    const terminal = createTerminal();
    const prompt = new TerminalBootstrapPrompt(terminal.input, terminal.output);
    const secret = prompt.askSecret('Password: ');

    terminal.rawInput.emit('data', Buffer.from('\u0003'));

    await expect(secret).rejects.toBeInstanceOf(
      BootstrapPromptInterruptedError,
    );
    expect(terminal.rawInput.setRawMode).toHaveBeenLastCalledWith(false);
  });
});
