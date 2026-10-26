import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { SessionService } from '../src/auth/session.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { loadConfig } from '../src/config';
import { WEB_ORIGIN, captureLogger, setupApp } from './helpers';

describe('Health, readiness and structured logging', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let http: Awaited<ReturnType<typeof setupApp>>['http'];
  let log: ReturnType<typeof captureLogger>;

  beforeAll(async () => {
    log = captureLogger();
    ({ app, prisma, http } = await setupApp({}, log.logger));
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    await prisma.$disconnect();
    await app.close();
  });
  beforeEach(() => {
    log.lines.length = 0;
  });

  const forRequest = (requestId: string) => log.entries().filter((e) => e.requestId === requestId);

  describe('GET /api/v1/health (liveness)', () => {
    it('returns 200 with a small, safe body', async () => {
      const res = await http().get('/api/v1/health').expect(200);
      expect(Object.keys(res.body).sort()).toEqual(['service', 'status', 'time', 'version']);
      expect(res.body).toMatchObject({ status: 'ok', service: 'krevia-api' });
    });

    it('stays healthy while the database is down (liveness does not check dependencies)', async () => {
      const spy = jest.spyOn(app.get(PrismaService), '$queryRaw').mockRejectedValue(new Error('connection refused'));
      await http().get('/api/v1/health').expect(200);
      spy.mockRestore();
    });
  });

  describe('GET /api/v1/ready (readiness)', () => {
    it('returns 200 when the database is reachable', async () => {
      const res = await http().get('/api/v1/ready').expect(200);
      expect(res.body).toEqual({ status: 'ready', service: 'krevia-api', checks: { database: 'up' } });
    });

    it('returns 503 without leaking details when the database is unavailable', async () => {
      const spy = jest
        .spyOn(app.get(PrismaService), '$queryRaw')
        .mockRejectedValue(new Error("Can't reach database server at postgresql://admin:s3cret@db.internal:5432/krevia"));
      const res = await http().get('/api/v1/ready').expect(503);
      expect(res.body).toEqual({ status: 'not_ready', service: 'krevia-api', checks: { database: 'down' } });
      expect(JSON.stringify(res.body)).not.toMatch(/postgres|s3cret|db\.internal|stack/i);
      // Reason is logged once, with credentials masked.
      const warn = log.entries().find((e) => e.msg === 'Readiness check failed: database unavailable');
      expect(warn).toMatchObject({ level: 'warn', context: 'Health' });
      expect(log.lines.join('\n')).not.toContain('s3cret');
      spy.mockRestore();
    });

    it('returns 503 promptly when the database hangs', async () => {
      const spy = jest.spyOn(app.get(PrismaService), '$queryRaw').mockReturnValue(new Promise(() => {}) as never);
      const started = Date.now();
      await http().get('/api/v1/ready').expect(503);
      expect(Date.now() - started).toBeLessThan(4000);
      spy.mockRestore();
    });
  });

  describe('request logging', () => {
    it('writes one structured access line per request, correlated with the X-Request-Id header', async () => {
      const res = await http().get('/api/v1/societies/not-a-uuid').set('Authorization', 'Bearer invalid-token-value').expect(401);
      const requestId = res.headers['x-request-id'] as string;
      expect(res.body.error.requestId).toBe(requestId);
      const lines = forRequest(requestId);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        level: 'warn',
        service: 'krevia-api',
        env: 'test',
        context: 'HTTP',
        method: 'GET',
        route: '/api/v1/societies/:id',
        status: 401,
        errorCode: 'UNAUTHENTICATED',
      });
      expect(typeof lines[0]!.durationMs).toBe('number');
      expect(typeof lines[0]!.time).toBe('string');
    });

    it('honours a well-formed incoming request id and replaces a malformed one', async () => {
      const ok = await http().get('/api/v1/health').set('X-Request-Id', 'client-req-0001');
      expect(ok.headers['x-request-id']).toBe('client-req-0001');
      expect(forRequest('client-req-0001')[0]).toMatchObject({ level: 'debug', route: '/api/v1/health' });
      const bad = await http().get('/api/v1/health').set('X-Request-Id', 'bad id with spaces <script>');
      expect(bad.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('never logs passwords, tokens, cookies, bodies or query strings', async () => {
      await http()
        .post('/api/v1/auth/login')
        .set('Origin', WEB_ORIGIN)
        .set('Authorization', 'Bearer super-secret-token-123')
        .set('Cookie', 'krevia_session=cookie-secret-456')
        .send({ phone: '9876500000', password: 'MyPassw0rd!' })
        .expect(401);
      await http().get('/api/v1/societies?q=private-search-term').set('Cookie', 'krevia_session=cookie-secret-456');
      const text = log.lines.join('\n');
      for (const secret of ['super-secret-token-123', 'cookie-secret-456', 'MyPassw0rd!', '9876500000', 'private-search-term']) {
        expect(text).not.toContain(secret);
      }
    });

    it('logs a server error exactly once with a safe code, redacted message and request id', async () => {
      // Simulate an infrastructure fault inside request handling (session lookup in the auth guard).
      const spy = jest
        .spyOn(app.get(SessionService), 'resolve')
        .mockRejectedValue(new Error('pool failure postgresql://admin:s3cret@db/krevia'));
      const res = await http().get('/api/v1/auth/me').set('Authorization', 'Bearer some-token-value').expect(500);
      expect(res.body.error).toMatchObject({ code: 'INTERNAL', message: 'Something went wrong. Please try again.' });
      expect(JSON.stringify(res.body)).not.toMatch(/s3cret|pool failure|stack/);
      const lines = forRequest(res.headers['x-request-id'] as string);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ level: 'error', status: 500, errorCode: 'INTERNAL', errorName: 'Error', route: '/api/v1/auth/me' });
      expect(lines[0]!.errorMessage).toBe('pool failure postgresql://[REDACTED]@db/krevia');
      expect(log.lines.join('\n')).not.toMatch(/s3cret|some-token-value/);
      spy.mockRestore();
    });
  });
});

describe('startup configuration validation', () => {
  it('names each missing or invalid variable without echoing values', () => {
    let message = '';
    try {
      loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'mysql://root:hunter2@db/x', LOG_LEVEL: 'loud', PORT: 'abc' });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/^Invalid environment configuration:/);
    expect(message).toContain('- DATABASE_URL: must be a postgresql:// connection URL');
    expect(message).toMatch(/- PORT: /);
    expect(message).toMatch(/- LOG_LEVEL: /);
    expect(message).toContain('apps/api/.env');
    expect(message).not.toContain('hunter2');
    expect(message).not.toContain('loud');
    expect(message).toContain('- LOG_LEVEL: must be one of: error, warn, info, debug');
    // An empty value is treated as missing.
    expect(() => loadConfig({ NODE_ENV: 'production', DATABASE_URL: '' })).toThrow(/DATABASE_URL: is required/);
  });

  it('describes the database target without credentials', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pw@localhost:5432/krevia_test',
      AUTH_PEPPER: 'p'.repeat(32),
    });
    expect(config.databaseTarget).toBe('krevia_test on localhost:5432');
    expect(config.logLevel).toBe('info');
  });

  it('production requires AUTH_PEPPER, refuses the dev outbox and defaults to no message delivery', () => {
    const base = { NODE_ENV: 'production', DATABASE_URL: 'postgresql://user:pw@localhost:5432/krevia_test' };
    expect(() => loadConfig(base)).toThrow(/AUTH_PEPPER: is required in production/);
    expect(() => loadConfig({ ...base, AUTH_PEPPER: 'short' })).toThrow(/AUTH_PEPPER: must be at least 32 characters/);
    expect(() => loadConfig({ ...base, AUTH_PEPPER: 'p'.repeat(32), MESSAGE_DELIVERY: 'dev-outbox' })).toThrow(/dev-outbox is not allowed/);
    const config = loadConfig({ ...base, AUTH_PEPPER: 'p'.repeat(32) });
    expect(config.messageDelivery).toBe('none');
    expect(config.cookieSecure).toBe(true);
  });
});
