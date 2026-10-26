import type { INestApplication } from '@nestjs/common';
import type { PrismaClient, Society } from '@prisma/client';
import { normalizeIndianMobile, type UnitDto } from '@krevia/shared';
import type request from 'supertest';
import { createAdmin, createGuard, createSociety, registerMobile, resetData, setupApp, uniquePhone } from './helpers';

/**
 * Sprint 4 acceptance: the full visitor lifecycle, duplicate/concurrent safety,
 * timeout, cancellation, emergency override, notifications and tenant isolation
 * against the real PostgreSQL test database.
 *
 * The app is started with MESSAGE_DELIVERY=none on purpose: this is the
 * production default while no SMS/email provider is configured. The suite
 * proves the workflow still works in-app and reports delivery honestly.
 */
describe('Sprint 4 — visitor and gate workflow', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let http: () => ReturnType<typeof request>;

  let A: Society;
  let B: Society;
  let unitA1: UnitDto;
  let unitA2: UnitDto;
  let unitB: UnitDto;
  type Actor = Awaited<ReturnType<typeof registerMobile>>;
  let adminA: Actor;
  let adminB: Actor;
  let guardA: Actor;
  let guardB: Actor;
  let residentA1: Actor;
  let residentA2: Actor;
  let residentB: Actor;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const api = (societyId: string, path: string) => `/api/v1/societies/${societyId}${path}`;

  async function createUnitViaApi(adminToken: string, societyId: string, body: Record<string, unknown>) {
    const res = await http().post(api(societyId, '/units')).set(auth(adminToken)).send(body).expect(201);
    return res.body.unit as UnitDto;
  }

  async function invitedResident(adminToken: string, society: Society, unit: UnitDto, name: string) {
    const user = await registerMobile(app, { fullName: name });
    const inv = await http()
      .post(api(society.id, '/invitations'))
      .set(auth(adminToken))
      .send({ phone: user.phone, role: 'RESIDENT', unitId: unit.id, occupancy: 'OWNER' })
      .expect(201);
    const token = new URL(inv.body.inviteUrl).searchParams.get('token')!;
    await http().post('/api/v1/invitations/accept').set(auth(user.token)).send({ token }).expect(200);
    return user;
  }

  let seq = 0;
  function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    seq += 1;
    return {
      name: `Visitor ${seq}`,
      phone: uniquePhone(),
      category: 'VISITOR',
      unitId: unitA1.id,
      purpose: `Test visit ${seq}`,
      ...overrides,
    };
  }

  const register = (actor: Actor, societyId: string, input: Record<string, unknown>) =>
    http().post(api(societyId, '/visitors')).set(auth(actor.token)).send(input);

  const create = async (input: Record<string, unknown> = body(), actor: Actor = guardA) => {
    const res = await register(actor, A.id, input).expect(201);
    return res.body.visitor as { id: string; status: string };
  };

  const auditActions = async (visitorId: string) => {
    const rows = await prisma.auditEvent.findMany({ where: { targetId: visitorId }, orderBy: { createdAt: 'asc' }, select: { action: true } });
    return rows.map((r) => r.action);
  };

  beforeAll(async () => {
    ({ app, prisma, http } = await setupApp({ MESSAGE_DELIVERY: 'none' }));
    await resetData(prisma);
    A = await createSociety(prisma, 'Green Valley Residency', ['T1']);
    B = await createSociety(prisma, 'Lakeview Heights', ['A']);
    adminA = await createAdmin(prisma, app, A.id);
    adminB = await createAdmin(prisma, app, B.id);
    guardA = await createGuard(prisma, app, A.id);
    guardB = await createGuard(prisma, app, B.id);

    const buildingA = (await http().post(api(A.id, '/buildings')).set(auth(adminA.token)).send({ name: 'T1' }).expect(201)).body.building;
    unitA1 = await createUnitViaApi(adminA.token, A.id, { buildingId: buildingA.id, number: '101' });
    unitA2 = await createUnitViaApi(adminA.token, A.id, { buildingId: buildingA.id, number: '102' });
    unitB = await createUnitViaApi(adminB.token, B.id, { tower: 'A', number: '1' });

    residentA1 = await invitedResident(adminA.token, A, unitA1, 'Asha Resident');
    residentA2 = await invitedResident(adminA.token, A, unitA2, 'Ravi Resident');
    residentB = await invitedResident(adminB.token, B, unitB, 'Bharat Lakeview');
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('01 registers a visitor and reports the unconfigured notification provider honestly', async () => {
    const input = body();
    const res = await register(guardA, A.id, input).expect(201);
    expect(res.body.created).toBe(true);
    expect(res.body.visitor.status).toBe('PENDING');
    expect(res.body.visitor.unit.id).toBe(unitA1.id);
    expect(res.body.visitor.phone).toBe(normalizeIndianMobile(input.phone as string));
    expect(res.body.notification).toEqual({ delivered: false, channel: 'none', recipients: 1 });

    const row = await prisma.visitor.findUniqueOrThrow({ where: { id: res.body.visitor.id } });
    expect(row.status).toBe('PENDING');
    const notes = await prisma.visitorNotification.findMany({ where: { visitorId: row.id } });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ kind: 'APPROVAL_REQUEST', channel: 'none', delivered: false });
    expect(await auditActions(row.id)).toContain('visitor.created');
  });

  it('02 shows the pending request to the destination resident, masks the phone and approves it', async () => {
    const visitor = await create(body({ phone: '9876543210' }));
    const list = await http().get(api(A.id, '/visitors?status=PENDING')).set(auth(residentA1.token)).expect(200);
    expect(list.body.items.map((v: { id: string }) => v.id)).toContain(visitor.id);
    const shown = list.body.items.find((v: { id: string }) => v.id === visitor.id);
    expect(shown.phone).toBe('+91******3210');

    const approved = await http().post(api(A.id, `/visitors/${visitor.id}/approve`)).set(auth(residentA1.token)).send({ note: 'Expected' }).expect(200);
    expect(approved.body.visitor.status).toBe('APPROVED');
    expect(approved.body.visitor.decidedBy.id).toBe(residentA1.user.id);
    expect(approved.body.visitor.decisionNote).toBe('Expected');
    expect(await auditActions(visitor.id)).toContain('visitor.approved');
  });

  it('03 rejects a request with a note', async () => {
    const visitor = await create();
    const rejected = await http().post(api(A.id, `/visitors/${visitor.id}/reject`)).set(auth(residentA1.token)).send({ note: 'Not known' }).expect(200);
    expect(rejected.body.visitor.status).toBe('REJECTED');
    expect(rejected.body.visitor.decisionNote).toBe('Not known');
    expect(await auditActions(visitor.id)).toContain('visitor.rejected');
  });

  it('04 refuses a duplicate approval and keeps a single audit transition', async () => {
    const visitor = await create();
    await http().post(api(A.id, `/visitors/${visitor.id}/approve`)).set(auth(residentA1.token)).send({}).expect(200);
    await http().post(api(A.id, `/visitors/${visitor.id}/approve`)).set(auth(residentA1.token)).send({}).expect(409);
    const actions = await auditActions(visitor.id);
    expect(actions.filter((a) => a === 'visitor.approved')).toHaveLength(1);
    expect((await prisma.visitor.findUniqueOrThrow({ where: { id: visitor.id } })).status).toBe('APPROVED');
  });

  it('05 returns the original visitor for a retry with the same idempotency key', async () => {
    const input = body({ idempotencyKey: `retry-${Date.now()}` });
    const first = await register(guardA, A.id, input).expect(201);
    const second = await register(guardA, A.id, input).expect(201);
    expect(second.body.created).toBe(false);
    expect(second.body.visitor.id).toBe(first.body.visitor.id);
    expect(await prisma.visitor.count({ where: { societyId: A.id, idempotencyKey: input.idempotencyKey as string } })).toBe(1);
  });

  it('06 refuses an identical open registration without an idempotency key', async () => {
    const input = body();
    await register(guardA, A.id, input).expect(201);
    const duplicate = await register(guardA, A.id, input).expect(409);
    expect(duplicate.body.error.code).toBe('CONFLICT');
    expect(await prisma.visitor.count({ where: { societyId: A.id, phone: normalizeIndianMobile(input.phone as string) } })).toBe(1);
  });

  it('07 refuses entry before approval, then records manual entry after approval', async () => {
    const visitor = await create();
    await http().post(api(A.id, `/visitors/${visitor.id}/entry`)).set(auth(guardA.token)).expect(409);
    await http().post(api(A.id, `/visitors/${visitor.id}/approve`)).set(auth(residentA1.token)).send({}).expect(200);
    const entered = await http().post(api(A.id, `/visitors/${visitor.id}/entry`)).set(auth(guardA.token)).expect(200);
    expect(entered.body.visitor.status).toBe('ENTERED');
    expect(entered.body.visitor.entryAt).toBeTruthy();
    expect(entered.body.visitor.entryMethod).toBe('MANUAL');
    expect(entered.body.visitor.entryBy.id).toBe(guardA.user.id);
    expect(await auditActions(visitor.id)).toContain('visitor.entered');
  });

  it('08 refuses a duplicate entry scan', async () => {
    const visitor = await create();
    await http().post(api(A.id, `/visitors/${visitor.id}/approve`)).set(auth(residentA1.token)).send({}).expect(200);
    await http().post(api(A.id, `/visitors/${visitor.id}/entry`)).set(auth(guardA.token)).expect(200);
    await http().post(api(A.id, `/visitors/${visitor.id}/entry`)).set(auth(guardA.token)).expect(409);
    expect((await auditActions(visitor.id)).filter((a) => a === 'visitor.entered')).toHaveLength(1);
  });

  it('09 refuses exit before entry', async () => {
    const visitor = await create();
    await http().post(api(A.id, `/visitors/${visitor.id}/approve`)).set(auth(residentA1.token)).send({}).expect(200);
    await http().post(api(A.id, `/visitors/${visitor.id}/exit`)).set(auth(guardA.token)).expect(409);
    expect((await prisma.visitor.findUniqueOrThrow({ where: { id: visitor.id } })).status).toBe('APPROVED');
  });

  it('10 records exit on the same row and refuses a duplicate exit', async () => {
    const visitor = await create();
    await http().post(api(A.id, `/visitors/${visitor.id}/approve`)).set(auth(residentA1.token)).send({}).expect(200);
    await http().post(api(A.id, `/visitors/${visitor.id}/entry`)).set(auth(guardA.token)).expect(200);
    const exited = await http().post(api(A.id, `/visitors/${visitor.id}/exit`)).set(auth(guardA.token)).expect(200);
    expect(exited.body.visitor.status).toBe('EXITED');
    expect(exited.body.visitor.exitAt).toBeTruthy();
    expect(exited.body.visitor.exitBy.id).toBe(guardA.user.id);
    await http().post(api(A.id, `/visitors/${visitor.id}/exit`)).set(auth(guardA.token)).expect(409);
    expect((await auditActions(visitor.id)).filter((a) => a === 'visitor.exited')).toHaveLength(1);
  });

  it('11 cancels a pending request with a reason and refuses later approval or entry', async () => {
    const visitor = await create();
    const cancelled = await http().post(api(A.id, `/visitors/${visitor.id}/cancel`)).set(auth(guardA.token)).send({ reason: 'Visitor left the gate' }).expect(200);
    expect(cancelled.body.visitor.status).toBe('CANCELLED');
    expect(cancelled.body.visitor.cancelReason).toBe('Visitor left the gate');
    await http().post(api(A.id, `/visitors/${visitor.id}/approve`)).set(auth(residentA1.token)).send({}).expect(409);
    await http().post(api(A.id, `/visitors/${visitor.id}/entry`)).set(auth(guardA.token)).expect(409);
    expect(await auditActions(visitor.id)).toContain('visitor.cancelled');
  });

  it('12 times out an unanswered request and refuses approval', async () => {
    const visitor = await create();
    await prisma.visitor.update({ where: { id: visitor.id }, data: { approvalExpiresAt: new Date(Date.now() - 60_000) } });
    const list = await http().get(api(A.id, '/visitors?status=TIMED_OUT')).set(auth(residentA1.token)).expect(200);
    expect(list.body.items.map((v: { id: string }) => v.id)).toContain(visitor.id);
    await http().post(api(A.id, `/visitors/${visitor.id}/approve`)).set(auth(residentA1.token)).send({}).expect(409);
    expect(await auditActions(visitor.id)).toContain('visitor.timed_out');
  });

  it('13 does not let a resident decide for another unit', async () => {
    const visitor = await create();
    await http().post(api(A.id, `/visitors/${visitor.id}/approve`)).set(auth(residentA2.token)).send({}).expect(404);
    expect((await prisma.visitor.findUniqueOrThrow({ where: { id: visitor.id } })).status).toBe('PENDING');
  });

  it('14 hides the register from a resident of another unit, in list and detail', async () => {
    const visitor = await create();
    const list = await http().get(api(A.id, '/visitors')).set(auth(residentA2.token)).expect(200);
    expect(list.body.items.map((v: { id: string }) => v.id)).not.toContain(visitor.id);
    await http().get(api(A.id, `/visitors/${visitor.id}`)).set(auth(residentA2.token)).expect(404);
  });

  it('15 denies another society\'s guard, both under the foreign URL and by id substitution', async () => {
    const visitor = await create();
    await http().get(api(A.id, `/visitors/${visitor.id}`)).set(auth(guardB.token)).expect(403);
    await http().get(api(B.id, `/visitors/${visitor.id}`)).set(auth(guardB.token)).expect(404);
    await http().post(api(B.id, `/visitors/${visitor.id}/entry`)).set(auth(guardB.token)).expect(404);
    // A resident of another society cannot read it either, even with a valid society id.
    await http().get(api(A.id, `/visitors/${visitor.id}`)).set(auth(residentB.token)).expect(403);
  });

  it('16 denies a guard approval and emergency override', async () => {
    const visitor = await create();
    await http().post(api(A.id, `/visitors/${visitor.id}/approve`)).set(auth(guardA.token)).send({}).expect(403);
    await http().post(api(A.id, `/visitors/${visitor.id}/override`)).set(auth(guardA.token)).send({ reason: 'Emergency at gate' }).expect(403);
    expect((await prisma.visitor.findUniqueOrThrow({ where: { id: visitor.id } })).status).toBe('PENDING');
  });

  it('17 denies visitor history to a signed-in user with no society membership', async () => {
    const outsider = await registerMobile(app, { fullName: 'No Membership' });
    await http().get(api(A.id, '/visitors')).set(auth(outsider.token)).expect(403);
  });

  it('18 requires a reason for an emergency override', async () => {
    const visitor = await create();
    await http().post(api(A.id, `/visitors/${visitor.id}/override`)).set(auth(adminA.token)).send({ reason: 'no' }).expect(400);
    expect((await prisma.visitor.findUniqueOrThrow({ where: { id: visitor.id } })).status).toBe('PENDING');
  });

  it('19 records an authorised emergency override with reason, actor and audit, then allows exit', async () => {
    const visitor = await create();
    const overridden = await http().post(api(A.id, `/visitors/${visitor.id}/override`)).set(auth(adminA.token)).send({ reason: 'Medical emergency' }).expect(200);
    expect(overridden.body.visitor.status).toBe('ENTERED');
    expect(overridden.body.visitor.entryMethod).toBe('OVERRIDE');
    expect(overridden.body.visitor.overrideReason).toBe('Medical emergency');
    expect(overridden.body.visitor.overriddenBy.id).toBe(adminA.user.id);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { targetId: visitor.id, action: 'visitor.overridden' } });
    expect((audit.metadata as { reason?: string }).reason).toBe('Medical emergency');
    const exited = await http().post(api(A.id, `/visitors/${visitor.id}/exit`)).set(auth(guardA.token)).expect(200);
    expect(exited.body.visitor.status).toBe('EXITED');
  });

  it('20 makes concurrent approvals safe: one success, one conflict', async () => {
    const visitor = await create();
    const [first, second] = await Promise.all([
      http().post(api(A.id, `/visitors/${visitor.id}/approve`)).set(auth(residentA1.token)).send({}),
      http().post(api(A.id, `/visitors/${visitor.id}/approve`)).set(auth(residentA1.token)).send({}),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect((await prisma.visitor.findUniqueOrThrow({ where: { id: visitor.id } })).status).toBe('APPROVED');
    expect((await auditActions(visitor.id)).filter((a) => a === 'visitor.approved')).toHaveLength(1);
  });

  it('21 filters the register by unit, category, status and date', async () => {
    const delivery = await create(body({ category: 'DELIVERY', unitId: unitA1.id, purpose: 'Parcel' }));
    const other = await create(body({ category: 'VISITOR', unitId: unitA2.id, purpose: 'Family' }));
    const byUnit = await http().get(api(A.id, `/visitors?unitId=${unitA1.id}&category=DELIVERY&status=PENDING`)).set(auth(adminA.token)).expect(200);
    const ids = byUnit.body.items.map((v: { id: string }) => v.id);
    expect(ids).toContain(delivery.id);
    expect(ids).not.toContain(other.id);
    const today = new Date().toISOString().slice(0, 10);
    const byDate = await http().get(api(A.id, `/visitors?dateFrom=${today}&dateTo=${today}`)).set(auth(adminA.token)).expect(200);
    expect(byDate.body.items.length).toBeGreaterThan(0);
  });

  it('22 refuses entry on a rejected visitor and exit on a cancelled visitor', async () => {
    const rejected = await create();
    await http().post(api(A.id, `/visitors/${rejected.id}/reject`)).set(auth(residentA1.token)).send({}).expect(200);
    await http().post(api(A.id, `/visitors/${rejected.id}/entry`)).set(auth(guardA.token)).expect(409);

    const cancelled = await create();
    await http().post(api(A.id, `/visitors/${cancelled.id}/cancel`)).set(auth(guardA.token)).send({ reason: 'No longer needed' }).expect(200);
    await http().post(api(A.id, `/visitors/${cancelled.id}/exit`)).set(auth(guardA.token)).expect(409);
  });

  it('23 keeps the audit history for the whole lifecycle and serves the gate destination picker', async () => {
    const visitor = await create();
    await http().post(api(A.id, `/visitors/${visitor.id}/approve`)).set(auth(residentA1.token)).send({}).expect(200);
    await http().post(api(A.id, `/visitors/${visitor.id}/entry`)).set(auth(guardA.token)).expect(200);
    await http().post(api(A.id, `/visitors/${visitor.id}/exit`)).set(auth(guardA.token)).expect(200);
    expect(await auditActions(visitor.id)).toEqual(
      expect.arrayContaining(['visitor.created', 'visitor.approved', 'visitor.entered', 'visitor.exited']),
    );

    const destinations = await http().get(api(A.id, '/visitors/destinations')).set(auth(guardA.token)).expect(200);
    expect(destinations.body.items.map((u: { id: string }) => u.id)).toEqual(expect.arrayContaining([unitA1.id, unitA2.id]));
    for (const unit of destinations.body.items) expect(Object.keys(unit).sort()).toEqual(['buildingName', 'id', 'number', 'tower']);
  });

  it('24 keeps the in-app request available when the provider is unavailable', async () => {
    const input = body();
    const res = await register(guardA, A.id, input).expect(201);
    expect(res.body.notification.delivered).toBe(false);
    expect(res.body.notification.channel).toBe('none');
    const pending = await http().get(api(A.id, '/visitors?status=PENDING')).set(auth(residentA1.token)).expect(200);
    expect(pending.body.items.map((v: { id: string }) => v.id)).toContain(res.body.visitor.id);
    const note = await prisma.visitorNotification.findFirstOrThrow({ where: { visitorId: res.body.visitor.id } });
    expect(note.delivered).toBe(false);
  });
});
