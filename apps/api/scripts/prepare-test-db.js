/**
 * Prepares a CLEAN test database: drops and recreates the `public` schema, then
 * applies all migrations with `prisma migrate deploy`.
 *
 * Safety rails (this script is destructive):
 *  - The URL comes from apps/api/.env.test when present (it overrides any DATABASE_URL
 *    exported in the shell, which might point at development data). In CI, where no
 *    file exists, the environment provides it.
 *  - The database name must end with `_test`.
 *  - It must not be the same database as the development DATABASE_URL in apps/api/.env.
 *  - Only "name on host:port" is printed, never credentials.
 */
const { execSync } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { parseEnv } = require('node:util');

const root = join(__dirname, '..');
const readEnv = (file) => (existsSync(join(root, file)) ? parseEnv(readFileSync(join(root, file), 'utf8')) : {});
const testEnv = readEnv('.env.test');
const url = testEnv.DATABASE_URL || process.env.DATABASE_URL;
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};
if (!url) fail('DATABASE_URL missing for tests: copy apps/api/.env.test.example to apps/api/.env.test');

let target;
try {
  target = new URL(url);
} catch {
  fail('DATABASE_URL for tests is not a valid URL');
}
const dbName = target.pathname.replace(/^\//, '');
const where = `${dbName} on ${target.hostname}${target.port ? `:${target.port}` : ''}`;
if (!/_test$/.test(dbName)) fail(`Refusing to reset "${where}": test database names must end with _test.`);

const devUrl = readEnv('.env').DATABASE_URL;
if (devUrl) {
  try {
    const dev = new URL(devUrl);
    if (dev.hostname === target.hostname && dev.port === target.port && dev.pathname === target.pathname) {
      fail(`Refusing to reset "${where}": it is the development database configured in apps/api/.env.`);
    }
  } catch {
    // An unparseable dev URL cannot be the same database.
  }
}

console.log(`Test database: ${where}`);
const env = { ...process.env, DATABASE_URL: url };
const run = (cmd, input) => execSync(cmd, { cwd: root, env, input, stdio: [input ? 'pipe' : 'inherit', 'inherit', 'inherit'] });
run('npx prisma db execute --stdin --schema prisma/schema.prisma', 'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
run('npx prisma migrate deploy');
console.log(`Test database ${where} recreated and migrated.`);
