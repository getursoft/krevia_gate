import { execSync } from 'node:child_process';
import path from 'node:path';
import { E2E } from '../playwright.config';

/** Recreates the e2e database schema, applies migrations and seeds sample data. */
export default function globalSetup() {
  const dbName = new URL(E2E.databaseUrl).pathname.slice(1);
  if (!dbName.endsWith('_test')) throw new Error(`Refusing to reset non-test database ${dbName}`);
  const apiDir = path.join(__dirname, '../../api');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'development' as const,
    DATABASE_URL: E2E.databaseUrl,
    SEED_ADMIN_PHONE: E2E.adminPhone,
    SEED_ADMIN_PASSWORD: E2E.adminPassword,
    SEED_GUARD_PHONE: E2E.guardPhone,
    SEED_GUARD_PASSWORD: E2E.guardPassword,
  };
  const run = (cmd: string, input?: string) =>
    execSync(cmd, { cwd: apiDir, env, input, stdio: ['pipe', 'inherit', 'inherit'] });
  run('npx prisma db execute --stdin --schema prisma/schema.prisma', 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  run('npx prisma migrate deploy');
  run('npx ts-node --transpile-only prisma/seed.ts');
}
