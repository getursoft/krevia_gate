import { AppLogger, REDACTED, redact, redactText, type LogLevel } from './logger';

function capture(level: LogLevel = 'debug', format: 'json' | 'pretty' = 'json') {
  const lines: string[] = [];
  const logger = new AppLogger({ service: 'krevia-api', env: 'test', level, format, write: (l) => lines.push(l) });
  return { logger, lines, entries: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>) };
}

describe('AppLogger', () => {
  it('writes one JSON object per line with timestamp, level, service, env and message', () => {
    const { logger, entries } = capture();
    logger.emit('info', 'GET /api/v1/health 200', { requestId: 'req-12345678', status: 200 });
    const [e] = entries();
    expect(e).toMatchObject({ level: 'info', service: 'krevia-api', env: 'test', msg: 'GET /api/v1/health 200', requestId: 'req-12345678', status: 200 });
    expect(new Date(e!.time as string).toISOString()).toBe(e!.time);
  });

  it('respects the configured level', () => {
    const { logger, lines } = capture('warn');
    logger.emit('debug', 'noise');
    logger.emit('info', 'noise');
    logger.emit('warn', 'kept');
    logger.emit('error', 'kept');
    expect(lines).toHaveLength(2);
  });

  it('implements the Nest LoggerService contract', () => {
    const { logger, entries } = capture();
    logger.log('Nest application successfully started', 'NestApplication');
    logger.warn('careful', 'Ctx');
    logger.error('boom', 'Error: boom\n    at x (y.ts:1:1)', 'Ctx');
    expect(entries().map((e) => [e.level, e.context])).toEqual([
      ['info', 'NestApplication'],
      ['warn', 'Ctx'],
      ['error', 'Ctx'],
    ]);
    expect(entries()[2]!.stack).toContain('at x');
  });

  it('pretty format stays readable for local development', () => {
    const { logger, lines } = capture('info', 'pretty');
    logger.emit('info', 'GET /x 200', { requestId: 'abc', status: 200 });
    expect(lines[0]).toMatch(/^\d{4}-\d\d-\d\dT.* INFO {2}GET \/x 200 requestId=abc status=200$/);
  });
});

describe('redaction', () => {
  it('removes sensitive keys at any depth', () => {
    const out = redact({
      password: 'Resident123',
      nested: { authorization: 'Bearer abc', Cookie: 'krevia_session=xyz', sessionToken: 't', apiKey: 'k', otp: '123456' },
      list: [{ newPassword: 'x' }],
      DATABASE_URL: 'postgresql://u:p@h/db',
      phoneCount: 3,
    }) as { password: string; nested: Record<string, string>; list: { newPassword: string }[]; DATABASE_URL: string; phoneCount: number };
    expect(out.password).toBe(REDACTED);
    expect(Object.values(out.nested)).toEqual([REDACTED, REDACTED, REDACTED, REDACTED, REDACTED]);
    expect(out.list[0].newPassword).toBe(REDACTED);
    expect(out.DATABASE_URL).toBe(REDACTED);
    expect(out.phoneCount).toBe(3);
  });

  it('masks credentials inside free text', () => {
    expect(redactText('connect failed postgresql://admin:s3cret@db.internal:5432/krevia')).toBe(
      `connect failed postgresql://${REDACTED}@db.internal:5432/krevia`,
    );
    expect(redactText('header Bearer eyJhbGciOi.payload.sig')).toBe(`header Bearer ${REDACTED}`);
  });

  it('reduces Error objects to a redacted name and message', () => {
    const out = redact({ error: new Error('pool at postgres://u:pw@host/db exhausted') }) as { error: unknown };
    expect(out.error).toEqual({ name: 'Error', message: `pool at postgres://${REDACTED}@host/db exhausted` });
  });

  it('never prints secrets passed in log fields', () => {
    const { logger, lines } = capture();
    logger.emit('error', 'login failed for Bearer abc.def', { password: 'Resident123', cookie: 'krevia_session=s3', url: 'postgresql://a:b@c/d' });
    const text = lines.join('\n');
    for (const secret of ['Resident123', 'krevia_session=s3', 'abc.def', ':b@']) expect(text).not.toContain(secret);
  });
});
