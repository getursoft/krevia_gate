import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { hashPassword } from '../src/auth/password';
import { createApp } from '../src/bootstrap';
import { AppLogger } from '../src/common/logger';
import { loadConfig } from '../src/config';

export const WEB_ORIGIN = 'http://localhost:3100';

/** A logger that keeps every JSON line in memory, for asserting on log output. */
export function captureLogger() {
  const lines: string[] = [];
  const logger = new AppLogger({ service: 'krevia-api', env: 'test', level: 'debug', format: 'json', write: (l) => lines.push(l) });
  return { logger, lines, entries: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>) };
}

export async function setupApp(overrides: NodeJS.ProcessEnv = {}, logger?: AppLogger) {
  const config = loadConfig({ ...process.env, NODE_ENV: 'test', AUTH_RATE_LIMIT: '1000', ...overrides });
  const dbName = new URL(process.env.DATABASE_URL ?? '').pathname;
  if (!dbName.endsWith('_test')) throw new Error('Integration tests must run against a *_test database');
  const app = await createApp(config, logger);
  await app.init();
  const prisma = new PrismaClient();
  return { app, prisma, http: () => request(app.getHttpServer()) };
}

export async function resetData(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "MembershipRequest", "Unit", "SocietyRole", "Session", "Society", "User" RESTART IDENTITY CASCADE',
  );
}

let phoneCounter = 0;
export function uniquePhone(): string {
  phoneCounter += 1;
  return `9${String(Date.now() % 1e5).padStart(5, '0')}${String(phoneCounter).padStart(4, '0')}`;
}

export const PASSWORD = 'Resident123';

/** Registers a user via the API as a mobile client and returns its bearer token. */
export async function registerMobile(
  app: INestApplication,
  data: Partial<{ fullName: string; phone: string; email: string; password: string }> = {},
) {
  const body = { fullName: 'Test Resident', phone: uniquePhone(), password: PASSWORD, ...data };
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .set('X-Krevia-Client', 'mobile')
    .send(body)
    .expect(201);
  return { token: res.body.token as string, user: res.body.user, phone: body.phone };
}

export async function createSociety(prisma: PrismaClient, name: string, towers = ['T1', 'T2']) {
  const slug = `${name.toLowerCase().replace(/\W+/g, '-')}-${Math.random().toString(36).slice(2, 7)}`;
  return prisma.society.create({
    data: { slug, name, addressLine: 'Test Road', city: 'Pune', state: 'Maharashtra', pincode: '411045', towers },
  });
}

export async function createAdmin(prisma: PrismaClient, app: INestApplication, societyId: string) {
  const admin = await registerMobile(app, { fullName: 'Society Admin' });
  await prisma.societyRole.create({ data: { userId: admin.user.id, societyId, role: 'ADMIN' } });
  return admin;
}

export async function createGuard(prisma: PrismaClient, app: INestApplication, societyId: string) {
  const guard = await registerMobile(app, { fullName: 'Gate Guard' });
  await prisma.societyRole.create({ data: { userId: guard.user.id, societyId, role: 'GUARD' } });
  return guard;
}

export { hashPassword };
