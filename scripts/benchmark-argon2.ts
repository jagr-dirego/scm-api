import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import argon2 from 'argon2';
import { parseEnvironment } from '../src/config/environment.schema';

const environment = parseEnvironment({
  ...process.env,
  DATABASE_URL:
    process.env.DATABASE_URL ??
    'postgresql://benchmark:benchmark@127.0.0.1:5432/benchmark',
});

const options = {
  type: argon2.argon2id as 2,
  memoryCost: environment.ARGON2_MEMORY_COST,
  timeCost: environment.ARGON2_TIME_COST,
  parallelism: environment.ARGON2_PARALLELISM,
  hashLength: environment.ARGON2_HASH_LENGTH,
};
const samples = 3;

async function benchmark() {
  const durations: number[] = [];

  for (let sample = 0; sample < samples; sample += 1) {
    const password = randomBytes(32).toString('base64url');
    const startedAt = performance.now();
    await argon2.hash(password, options);
    durations.push(performance.now() - startedAt);
  }

  const averageMs =
    durations.reduce((total, value) => total + value, 0) / samples;

  console.log({
    algorithm: 'argon2id',
    memoryCostKiB: options.memoryCost,
    timeCost: options.timeCost,
    parallelism: options.parallelism,
    hashLength: options.hashLength,
    samples,
    averageMs: Math.round(averageMs),
    minMs: Math.round(Math.min(...durations)),
    maxMs: Math.round(Math.max(...durations)),
  });
}

void benchmark();
