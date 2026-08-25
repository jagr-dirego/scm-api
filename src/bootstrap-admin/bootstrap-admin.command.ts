import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { ZodError } from 'zod';
import {
  BootstrapAdminCommandRunner,
  BootstrapCommandCancelledError,
} from './bootstrap-admin.command-runner';
import {
  BootstrapAlreadyCompletedError,
  BootstrapConflictError,
  BootstrapPrerequisiteError,
} from './errors/bootstrap.errors';
import {
  BootstrapPromptInterruptedError,
  InteractiveTerminalRequiredError,
  TerminalBootstrapPrompt,
} from './terminal-bootstrap.prompt';

const knownErrors = [
  BootstrapCommandCancelledError,
  BootstrapPromptInterruptedError,
  InteractiveTerminalRequiredError,
  BootstrapAlreadyCompletedError,
  BootstrapConflictError,
  BootstrapPrerequisiteError,
];

async function run(): Promise<void> {
  if (process.argv.slice(2).length > 0) {
    throw new BootstrapCommandCancelledError('El comando no acepta argumentos');
  }

  if (existsSync('.env')) {
    process.loadEnvFile('.env');
  }

  const { BootstrapAdminModule } = await import('./bootstrap-admin.module.js');

  const application = await NestFactory.createApplicationContext(
    BootstrapAdminModule,
    { logger: false },
  );

  try {
    const runner = application.get(BootstrapAdminCommandRunner);
    await runner.run(new TerminalBootstrapPrompt());
    process.stdout.write('Bootstrap completado correctamente.\n');
  } finally {
    await application.close();
  }
}

void run().catch((error: unknown) => {
  if (error instanceof ZodError) {
    const fields = [...new Set(error.issues.map((issue) => issue.path[0]))]
      .filter((field): field is string => typeof field === 'string')
      .join(', ');
    process.stderr.write(`Datos invalidos. Revise: ${fields}.\n`);
  } else {
    const knownError = knownErrors.find(
      (ErrorType) => error instanceof ErrorType,
    );
    process.stderr.write(
      knownError && error instanceof Error
        ? `${error.message}.\n`
        : 'No fue posible completar el bootstrap.\n',
    );
  }
  process.exitCode = 1;
});
