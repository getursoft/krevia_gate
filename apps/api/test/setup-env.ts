import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { loadEnvFileInto } from '../src/config';

const file = join(__dirname, '..', '.env.test');
if (existsSync(file)) {
  // The test database always comes from .env.test, even if the shell exports a
  // (possibly development) DATABASE_URL. Other values only fill gaps.
  const testUrl = parseEnv(readFileSync(file, 'utf8')).DATABASE_URL;
  if (testUrl) process.env.DATABASE_URL = testUrl;
  loadEnvFileInto(process.env, file);
}
