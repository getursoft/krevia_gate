import { redact, redactText } from '@krevia/shared';

/**
 * Structured server-side logging for the website (same line shape as the API:
 * `{ time, level, service, env, msg, ...fields }`). Fields are redacted, so
 * cookies, tokens and credentials never reach the output.
 * LOG_LEVEL: error | warn | info | debug (default info). LOG_FORMAT: json | pretty (default json).
 */
type Level = 'error' | 'warn' | 'info' | 'debug';
const RANK: Record<Level, number> = { error: 0, warn: 1, info: 2, debug: 3 };

export interface LogSink {
  (line: string, level: Level): void;
}

const defaultSink: LogSink = (line, level) => (level === 'error' ? console.error(line) : console.log(line));

export function createWebLogger(options: { level?: string; format?: string; env?: string; sink?: LogSink } = {}) {
  const level = (Object.keys(RANK).includes(options.level ?? '') ? options.level : 'info') as Level;
  const format = options.format === 'pretty' ? 'pretty' : 'json';
  const sink = options.sink ?? defaultSink;
  return function log(lvl: Level, msg: string, fields: Record<string, unknown> = {}) {
    if (RANK[lvl] > RANK[level]) return;
    const entry = {
      time: new Date().toISOString(),
      level: lvl,
      service: 'krevia-web',
      env: options.env ?? 'development',
      msg: redactText(msg),
      ...(redact(fields) as Record<string, unknown>),
    };
    sink(format === 'json' ? JSON.stringify(entry) : `${entry.time} ${lvl.toUpperCase().padEnd(5)} ${entry.msg} ${JSON.stringify(redact(fields))}`, lvl);
  };
}

export const log = createWebLogger({ level: process.env.LOG_LEVEL, format: process.env.LOG_FORMAT, env: process.env.NODE_ENV });
