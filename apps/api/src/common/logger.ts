import type { LoggerService } from '@nestjs/common';
import { REDACTED, redact, redactText } from '@krevia/shared';

export { REDACTED, redact, redactText };

export const LOG_LEVELS = ['error', 'warn', 'info', 'debug'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
export type LogFormat = 'json' | 'pretty';

const RANK: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

export interface LoggerOptions {
  service: string;
  env: string;
  level: LogLevel;
  format: LogFormat;
  /** Output sink; defaults to stdout (stderr for errors). Overridable for tests. */
  write?: (line: string, level: LogLevel) => void;
}

const defaultWrite = (line: string, level: LogLevel) =>
  (level === 'error' ? process.stderr : process.stdout).write(`${line}\n`);

/**
 * Structured application logger. Every line is one JSON object:
 * `{ time, level, service, env, msg, context?, ...fields }`. All fields pass
 * through `redact`, so passwords, tokens, cookies and connection-string
 * credentials never reach the output. `format: 'pretty'` prints a readable
 * single line for local development.
 */
export class AppLogger implements LoggerService {
  private readonly write: (line: string, level: LogLevel) => void;

  constructor(private readonly options: LoggerOptions) {
    this.write = options.write ?? defaultWrite;
  }

  isEnabled(level: LogLevel): boolean {
    return RANK[level] <= RANK[this.options.level];
  }

  emit(level: LogLevel, msg: string, fields: Record<string, unknown> = {}) {
    if (!this.isEnabled(level)) return;
    const entry = {
      time: new Date().toISOString(),
      level,
      service: this.options.service,
      env: this.options.env,
      msg: redactText(msg),
      ...(redact(fields) as Record<string, unknown>),
    };
    if (this.options.format === 'json') {
      this.write(JSON.stringify(entry), level);
      return;
    }
    const { time, service: _s, env: _e, msg: m, ...rest } = entry;
    const extra = Object.entries(rest)
      .filter(([k]) => k !== 'level')
      .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join(' ');
    this.write(`${time} ${level.toUpperCase().padEnd(5)} ${m}${extra ? ` ${extra}` : ''}`, level);
  }

  info(msg: string, fields?: Record<string, unknown>) {
    this.emit('info', msg, fields);
  }

  // ---- Nest LoggerService (framework messages: bootstrap, route mapping, etc.) ----
  log(message: unknown, context?: string) {
    this.emit('info', String(message), context ? { context } : {});
  }

  error(message: unknown, stackOrContext?: string, context?: string) {
    const fields: Record<string, unknown> = {};
    if (context) fields.context = context;
    else if (stackOrContext && !stackOrContext.includes('\n')) fields.context = stackOrContext;
    if (stackOrContext?.includes('\n') && this.options.env !== 'production') fields.stack = stackOrContext;
    this.emit('error', message instanceof Error ? message.message : String(message), fields);
  }

  warn(message: unknown, context?: string) {
    this.emit('warn', String(message), context ? { context } : {});
  }

  debug(message: unknown, context?: string) {
    this.emit('debug', String(message), context ? { context } : {});
  }

  verbose(message: unknown, context?: string) {
    this.emit('debug', String(message), context ? { context } : {});
  }
}

export const LOGGER = Symbol('LOGGER');
