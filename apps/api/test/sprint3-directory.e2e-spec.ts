import type { INestApplication } from '@nestjs/common';
import type { PrismaClient, Society, Unit } from '@prisma/client';
import type { UnitDto } from '@krevia/shared';
import type request from 'supertest';
import { createAdmin, createGuard, createSociety, registerMobile, resetData, setupApp } from './helpers';

/**
 * Sprint 3 acceptance: buildings/floors/units, the resident directory, CSV
 * import and tenant isolation against the real PostgreSQL test database.
 */
describe('Sprint 3 — resident & unit directory', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let http: () => ReturnType<typeof request>;

  let A: Society;
  let B: Society;
  let buildingA: { id: string; name: string };
  let floorA: { id: string; level: number };
  let unitA: UnitDto;
  let unitB: UnitDto;
  type Actor = Awaited<ReturnType<typeof registerMobile>>;
  let adminA: Actor;
  let adminB: Actor;
  let guardA: Actor;
  let residentA: Actor;
  let residentBRecord: { id: string };
  let importUnits: Unit[] = [];

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const csv = (rows: string[]) =>
    [
      'Tower/Block,Floor,Unit Number,Resident Name,Mobile Number,Email,Relationship,Primary Resident,Emergency Contact Name,Emergency Contact Phone,Vehicles',
      ...rows,
    ].join('\n');
  const preview = (token: string, societyId: string, body: string, fileName = 'residents.csv') =>
    http()
      .post(`/api/v1/societies/${societyId}/residents/imports/preview?fileName=${encodeURIComponent(fileName)}`)
      .set(auth(token))
      .set('Content-Type', 'text/csv')
      .send(body);

  async function createUnitViaApi(adminToken: string, societyId: string, body: Record<string, unknown>) {
    const res = await http().post(`/api/v1/societies/${societyId}/units`).set(auth(adminToken)).send(body).expect(201);
    return res.body.unit as UnitDto;
  }

  async function invitedResident(adminToken: string, society: Society, unit: UnitDto, name: string) {
    const user = await registerMobile(app, { fullName: name });
    const inv = await http()
      .post(`/api/v1/societies/${society.id}/invitations`)
      .set(auth(adminToken))
      .send({ phone: user.phone, role: 'RESIDENT', unitId: unit.id, occupancy: 'OWNER' })
      .expect(201);
    const token = new URL(inv.body.inviteUrl).searchParams.get('token')!;
    await http().post('/api/v1/invitations/accept').set(auth(user.token)).send({ token }).expect(200);
    return user;
  }

  beforeAll(async () => {
    ({ app, prisma, http } = await setupApp());
    await resetData(prisma);
    A = await createSociety(prisma, 'Green Valley Residency', ['T1', 'T2']);
    B = await createSociety(prisma, 'Lakeview Heights', ['A', 'B']);
    adminA = await createAdmin(prisma, app, A.id);
    adminB = await createAdmin(prisma, app, B.id);
    guardA = await createGuard(prisma, app, A.id);

    buildingA = (await http().post(`/api/v1/societies/${A.id}/buildings`).set(auth(adminA.token)).send({ name: 'T1' }).expect(201)).body.building;
    floorA = (await http().post(`/api/v1/societies/${A.id}/buildings/${buildingA.id}/floors`).set(auth(adminA.token)).send({ level: 0, name: 'Ground' }).expect(201)).body.floor;
    unitA = await createUnitViaApi(adminA.token, A.id, { buildingId: buildingA.id, floorId: floorA.id, number: '101' });
    unitB = await createUnitViaApi(adminB.token, B.id, { tower: 'A', number: '1' });

    residentA = await invitedResident(adminA.token, A, unitA, 'Asha Resident');
    await invitedResident(adminB.token, B, unitB, 'Bharat Lakeview');
    residentBRecord = (await http().get(`/api/v1/societies/${B.id}/residents`).set(auth(adminB.token)).expect(200)).body.items[0];

    // 100 units for the bulk import test (created directly; the API create path is covered above).
    importUnits = [];
    for (let i = 0; i < 100; i += 1) {
      importUnits.push(
        await prisma.unit.create({
          data: { societyId: A.id, buildingId: buildingA.id, floorId: floorA.id, tower: 'T1', number: `I${1000 + i}` },
        }),
      );
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  describe('buildings, floors and units', () => {
    it('creates a building and floor, rejects a duplicate floor, and creates a unit on it', async () => {
      await http().post(`/api/v1/societies/${A.id}/buildings/${buildingA.id}/floors`).set(auth(adminA.token)).send({ level: 0 }).expect(409);
      const detail = await http().get(`/api/v1/societies/${A.id}/buildings/${buildingA.id}`).set(auth(adminA.token)).expect(200);
      expect(detail.body.building.floors).toHaveLength(1);
      expect(detail.body.building.unitCount).toBe(101);
      expect(unitA.floorId).toBe(floorA.id);
      expect(unitA.buildingId).toBe(buildingA.id);
      const occupied = await http().get(`/api/v1/societies/${A.id}/units/${unitA.id}`).set(auth(adminA.token)).expect(200);
      expect(occupied.body.unit.occupancyStatus).toBe('OCCUPIED');
    });

    it('renames and moves a unit, then archives and restores it', async () => {
      const extra = await createUnitViaApi(adminA.token, A.id, { buildingId: buildingA.id, floorId: floorA.id, number: 'TMP1' });
      const moved = await http().patch(`/api/v1/societies/${A.id}/units/${extra.id}`).set(auth(adminA.token)).send({ number: 'TMP2' }).expect(200);
      expect(moved.body.unit.number).toBe('TMP2');
      await http().post(`/api/v1/societies/${A.id}/units/${extra.id}/archive`).set(auth(adminA.token)).expect(200);
      const archived = await http().get(`/api/v1/societies/${A.id}/units/${extra.id}`).set(auth(adminA.token)).expect(200);
      expect(archived.body.unit.status).toBe('ARCHIVED');
      await http().post(`/api/v1/societies/${A.id}/units/${extra.id}/restore`).set(auth(adminA.token)).expect(200);
      const restored = await http().get(`/api/v1/societies/${A.id}/units/${extra.id}`).set(auth(adminA.token)).expect(200);
      expect(restored.body.unit.status).toBe('ACTIVE');
    });

    it('refuses to archive an occupied unit', async () => {
      const res = await http().post(`/api/v1/societies/${A.id}/units/${unitA.id}/archive`).set(auth(adminA.token)).expect(409);
      expect(res.body.error.code).toBe('CONFLICT');
    });

    it('refuses to archive a building with active units, then succeeds after archiving them', async () => {
      const temp = (await http().post(`/api/v1/societies/${A.id}/buildings`).set(auth(adminA.token)).send({ name: 'TEMP' }).expect(201)).body.building;
      const tempUnit = await createUnitViaApi(adminA.token, A.id, { buildingId: temp.id, number: '1' });
      await http().post(`/api/v1/societies/${A.id}/buildings/${temp.id}/archive`).set(auth(adminA.token)).expect(409);
      await http().post(`/api/v1/societies/${A.id}/units/${tempUnit.id}/archive`).set(auth(adminA.token)).expect(200);
      await http().post(`/api/v1/societies/${A.id}/buildings/${temp.id}/archive`).set(auth(adminA.token)).expect(200);
    });
  });

  describe('resident directory', () => {
    it('creates a household member, enforces unique phones and returns admin-only details', async () => {
      const created = await http()
        .post(`/api/v1/societies/${A.id}/residents`)
        .set(auth(adminA.token))
        .send({ fullName: 'Meera Household', phone: '8888800001', unitId: unitA.id, relationship: 'HOUSEHOLD', emergencyContactName: 'Ravi', emergencyContactPhone: '8888800002', vehicles: [{ number: 'MH12AB1234' }] })
        .expect(201);
      expect(created.body.resident.units).toHaveLength(1);
      expect(created.body.resident.emergencyContactName).toBe('Ravi');
      await http()
        .post(`/api/v1/societies/${A.id}/residents`)
        .set(auth(adminA.token))
        .send({ fullName: 'Duplicate Phone', phone: '8888800001', unitId: unitA.id, relationship: 'TENANT' })
        .expect(409);
      const list = await http().get(`/api/v1/societies/${A.id}/residents?q=Meera`).set(auth(adminA.token)).expect(200);
      expect(list.body.items).toHaveLength(1);
    });

    it('returns only the resident own profile and masked household contacts', async () => {
      const household = await http().get(`/api/v1/societies/${A.id}/my-household`).set(auth(residentA.token)).expect(200);
      expect(household.body.resident.userId).toBe(residentA.user.id);
      expect(household.body.units[0].household.some((p: { fullName: string }) => p.fullName === 'Meera Household')).toBe(true);
      const meera = household.body.units[0].household.find((p: { fullName: string }) => p.fullName === 'Meera Household');
      expect(meera.maskedPhone).not.toBe('+918888800001');
      expect(meera.maskedPhone).toContain('0001');
      expect(meera.emergencyContactName).toBeUndefined();
      expect(JSON.stringify(household.body)).not.toContain('Ravi');
    });

    it('ends a resident-unit link together with its authenticated assignment', async () => {
      const detail = await http().get(`/api/v1/societies/${A.id}/residents`).set(auth(adminA.token)).expect(200);
      const asha = detail.body.items.find((r: { userId: string | null }) => r.userId === residentA.user.id);
      const link = asha.units.find((u: { endedAt: string | null }) => u.endedAt === null);
      await http().delete(`/api/v1/societies/${A.id}/residents/${asha.id}/units/${link.id}`).set(auth(adminA.token)).expect(200);
      const after = await prisma.residentUnit.findUniqueOrThrow({ where: { id: link.id } });
      expect(after.endedAt).not.toBeNull();
      const assignment = await prisma.unitAssignment.findFirst({ where: { membership: { userId: residentA.user.id }, unitId: unitA.id } });
      expect(assignment?.endedAt).not.toBeNull();
    });
  });

  describe('CSV import', () => {
    it('serves the template and rejects a malformed header', async () => {
      const template = await http().get(`/api/v1/societies/${A.id}/residents/import/template`).set(auth(adminA.token)).expect(200);
      expect(template.headers['content-type']).toContain('text/csv');
      expect(template.text).toContain('Tower/Block,Floor,Unit Number');
      const bad = await preview(adminA.token, A.id, 'Wrong,Header\n1,2').expect(400);
      expect(bad.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('imports 100 rows, then treats the same file and confirmation as idempotent', async () => {
      const rows = importUnits.map((unit, i) => `T1,0,${unit.number},Import Resident ${i + 1},8888810${String(i).padStart(3, '0')},import${i + 1}@example.com,OWNER,${i === 0 ? 'Yes' : 'No'},,,`);
      const body = csv(rows);
      const first = await preview(adminA.token, A.id, body).expect(200);
      expect(first.body.job.status).toBe('PREVIEWED');
      expect(first.body.job.totalRows).toBe(100);
      expect(first.body.job.validRows).toBe(100);
      expect(first.body.job.invalidRows).toBe(0);

      const same = await preview(adminA.token, A.id, body).expect(200);
      expect(same.body.job.id).toBe(first.body.job.id);
      expect(same.body.job.alreadyProcessed).toBe(true);

      const confirmed = await http().post(`/api/v1/societies/${A.id}/residents/imports/${first.body.job.id}/confirm`).set(auth(adminA.token)).expect(200);
      expect(confirmed.body.job.status).toBe('COMPLETED');
      expect(confirmed.body.job.createdRows).toBe(100);
      expect(confirmed.body.job.updatedRows).toBe(0);
      expect(await prisma.resident.count({ where: { societyId: A.id, fullName: { startsWith: 'Import Resident' } } })).toBe(100);
      expect(await prisma.residentUnit.count({ where: { societyId: A.id, unitId: { in: importUnits.map((u) => u.id) } } })).toBe(100);

      const again = await http().post(`/api/v1/societies/${A.id}/residents/imports/${first.body.job.id}/confirm`).set(auth(adminA.token)).expect(200);
      expect(again.body.job.alreadyProcessed).toBe(true);
      expect(again.body.job.createdRows).toBe(100);
      expect(await prisma.resident.count({ where: { societyId: A.id, fullName: { startsWith: 'Import Resident' } } })).toBe(100);

      const audit = await prisma.auditEvent.findFirst({ where: { societyId: A.id, action: 'resident.import.completed', targetId: first.body.job.id } });
      expect(audit).not.toBeNull();
      expect(audit?.outcome).toBe('SUCCESS');
    });

    it('marks duplicate and invalid rows, and produces a formula-safe error report', async () => {
      const body = csv([
        `T1,0,${importUnits[0].number},Import Resident 1,8888810000,,OWNER,No,,,`, // already linked -> SKIP
        `T1,0,${importUnits[0].number},Import Resident 1,8888810000,,OWNER,No,,,`, // same row twice -> SKIP/duplicate
        `T1,0,${importUnits[1].number},=cmd|' /C calc'!A0,123,,OWNER,No,,,`, // bad phone, formula name
        `T1,0,NOPE-404,Unknown Unit,8888810999,,OWNER,No,,,`, // unknown unit
        `T1,0,${importUnits[2].number},Different Name,8888810002,,OWNER,No,,,`, // name conflict with phone
      ]);
      const res = await preview(adminA.token, A.id, body, 'mixed.csv').expect(200);
      expect(res.body.job.duplicateRows).toBeGreaterThanOrEqual(1);
      expect(res.body.job.invalidRows).toBeGreaterThanOrEqual(3);
      expect(res.body.job.rows.find((r: { rowNumber: number }) => r.rowNumber === 4).action).toBe('REJECT');

      const report = await http()
        .get(`/api/v1/societies/${A.id}/residents/imports/${res.body.job.id}/errors.csv`)
        .set(auth(adminA.token))
        .expect(200);
      expect(report.headers['content-type']).toContain('text/csv');
      expect(report.text).toContain("'=cmd");
      expect(report.text).not.toContain(',=cmd');
    });

    it('does not import a row that references another society', async () => {
      const before = await prisma.residentUnit.count({ where: { unitId: unitB.id } });
      const res = await preview(adminA.token, A.id, csv([`A,0,1,Cross Society,8888810777,,OWNER,No,,,`]), 'cross.csv').expect(200);
      expect(res.body.job.validRows).toBe(0);
      expect(res.body.job.rows[0].message).toContain('not in this society');
      await http().post(`/api/v1/societies/${A.id}/residents/imports/${res.body.job.id}/confirm`).set(auth(adminA.token)).expect(200);
      expect(await prisma.residentUnit.count({ where: { unitId: unitB.id } })).toBe(before);
    });
  });

  describe('tenant isolation', () => {
    it('denies residents and guards the admin directory', async () => {
      for (const path of ['residents', 'buildings', `residents/imports`, 'residents/import/template']) {
        await http().get(`/api/v1/societies/${A.id}/${path}`).set(auth(residentA.token)).expect(403);
        await http().get(`/api/v1/societies/${A.id}/${path}`).set(auth(guardA.token)).expect(403);
      }
      await http().post(`/api/v1/societies/${A.id}/residents`).set(auth(guardA.token)).send({}).expect(403);
      await http().get(`/api/v1/societies/${B.id}/my-household`).set(auth(residentA.token)).expect(403);
    });

    it('answers 404 when a Society A admin substitutes Society B ids under the A URL', async () => {
      await http().get(`/api/v1/societies/${A.id}/residents/${residentBRecord.id}`).set(auth(adminA.token)).expect(404);
      await http().get(`/api/v1/societies/${A.id}/buildings/${(await prisma.building.findFirstOrThrow({ where: { societyId: B.id } })).id}`).set(auth(adminA.token)).expect(404);
      await http().get(`/api/v1/societies/${A.id}/units/${unitB.id}`).set(auth(adminA.token)).expect(404);
      await http().patch(`/api/v1/societies/${A.id}/residents/${residentBRecord.id}`).set(auth(adminA.token)).send({ fullName: 'Hijacked' }).expect(404);
      await http().post(`/api/v1/societies/${A.id}/residents/${residentBRecord.id}/archive`).set(auth(adminA.token)).expect(404);
    });

    it('cannot read or confirm another society CSV import or its error report', async () => {
      const jobB = (await preview(adminB.token, B.id, csv([`A,0,1,Bharat Lakeview,8888810888,,OWNER,No,,,`]), 'b.csv').expect(200)).body.job;
      await http().get(`/api/v1/societies/${A.id}/residents/imports/${jobB.id}`).set(auth(adminA.token)).expect(404);
      await http().get(`/api/v1/societies/${A.id}/residents/imports/${jobB.id}/errors.csv`).set(auth(adminA.token)).expect(404);
      await http().post(`/api/v1/societies/${A.id}/residents/imports/${jobB.id}/confirm`).set(auth(adminA.token)).expect(404);
    });
  });
});
