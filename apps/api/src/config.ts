import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { z } from 'zod';

/** Enum whose error lists the allowed values but never the received one. */
const oneOf = <const T extends [string, ...string[]]>(values: T) =>
  z.enum(values, { errorMap: () => ({ message: `must be one of: ${values.join(', ')}` }) });

const envSchema = z.object({
  NODE_ENV: oneOf(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number({ invalid_type_error: 'must be a port number' }).int().positive().default(4100),
  DATABASE_URL: z
    .string({ required_error: 'is required (PostgreSQL connection URL)' })
    .min(1, 'is required (PostgreSQL connection URL)')
    .regex(/^postgres(ql)?:\/\//, 'must be a postgresql:// connection URL'),
  CORS_ORIGINS: z.string().default('http://localhost:3100'),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 90).default(720),
  COOKIE_SECURE: oneOf(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  TRUST_PROXY: oneOf(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  AUTH_RATE_LIMIT: z.coerce.number().int().min(1).default(10),
  AUTH_RATE_TTL_SECONDS: z.coerce.number().int().min(1).default(60),
  LOG_LEVEL: oneOf(['error', 'warn', 'info', 'debug']).optional(),
  LOG_FORMAT: oneOf(['json', 'pretty']).default('json'),
});

/** Variables the API cannot start without; everything else has a safe default. */
export const REQUIRED_ENV = ['DATABASE_URL'] as const;

export type AppConfig = ReturnType<typeof loadConfig>;

/** Loads `.env` (outside production) and validates the environment. Never logs values. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV !== 'production') {
    const file = env.NODE_ENV === 'test' ? '.env.test' : '.env';
    const path = join(__dirname, '..', file);
    if (existsSync(path)) loadEnvFileInto(process.env, path);
  }
  const parsed = envSchema.safeParse(env === process.env ? env : { ...process.env, ...env });
  if (!parsed.success) {
    // Name each variable and the rule it broke; never echo the value (it may be a secret).
    const seen = new Set<string>();
    const lines = parsed.error.issues
      .filter((i) => !seen.has(i.path.join('.')) && seen.add(i.path.join('.')))
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    const file =
      env.NODE_ENV === 'test' ? 'apps/api/.env.test (see .env.test.example)' : 'apps/api/.env (see .env.example)';
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}\nSet these in ${file} or the process environment.`);
  }
  const c = parsed.data;
  const isProduction = c.NODE_ENV === 'production';
  return {
    env: c.NODE_ENV,
    isProduction,
    port: c.PORT,
    corsOrigins: c.CORS_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    sessionTtlMs: c.SESSION_TTL_HOURS * 3600 * 1000,
    cookieSecure: isProduction || c.COOKIE_SECURE,
    trustProxy: c.TRUST_PROXY,
    authRateLimit: c.AUTH_RATE_LIMIT,
    authRateTtlMs: c.AUTH_RATE_TTL_SECONDS * 1000,
    logLevel: c.LOG_LEVEL ?? (c.NODE_ENV === 'test' ? 'error' : 'info'),
    logFormat: c.LOG_FORMAT,
    /** Safe description of the database target for logs: name + host only, never credentials. */
    databaseTarget: describeDatabase(c.DATABASE_URL),
  };
}

/** "krevia_test on localhost:5432" — for logs and test-runner banners. */
export function describeDatabase(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname.replace(/^\//, '') || '(default)'} on ${u.hostname}${u.port ? `:${u.port}` : ''}`;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

/** Copies KEY=value pairs from a dotenv file without overriding variables already set. */
export function loadEnvFileInto(target: NodeJS.ProcessEnv, path: string) {
  const values = parseEnv(readFileSync(path, 'utf8'));
  for (const [key, value] of Object.entries(values)) {
    if (target[key] === undefined) target[key] = value;
  }
}

export const APP_CONFIG = Symbol('APP_CONFIG');
export const SESSION_COOKIE = 'krevia_session';
