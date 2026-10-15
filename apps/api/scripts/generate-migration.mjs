// `pnpm db:generate --name <name>`: runs drizzle-kit with the given arguments, then removes the
// hard-coded "public" schema drizzle-kit writes into foreign keys (see unqualify-migrations.mjs).
import { spawnSync } from 'node:child_process';

const result = spawnSync('drizzle-kit', ['generate', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (result.status !== 0) process.exit(result.status ?? 1);
await import('./unqualify-migrations.mjs');
