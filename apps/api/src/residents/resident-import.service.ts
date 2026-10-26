import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { ImportJobStatus, OccupancyType, ResidentImportJob } from '@prisma/client';
import { normalizeIndianMobile, OCCUPANCY_TYPES, type ImportPreviewRowDto, type ImportRowAction, type ImportRowErrorDto, type ResidentImportJobDto } from '@krevia/shared';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';

/** Columns written by the downloadable template. Aliases are accepted on upload. */
export const IMPORT_HEADERS = [
  'Tower/Block',
  'Floor',
  'Unit Number',
  'Resident Name',
  'Mobile Number',
  'Email',
  'Relationship',
  'Primary Resident',
  'Emergency Contact Name',
  'Emergency Contact Phone',
  'Vehicles',
] as const;

const HEADER_ALIASES: Record<string, (typeof IMPORT_HEADERS)[number]> = {
  'tower/block': 'Tower/Block',
  tower: 'Tower/Block',
  building: 'Tower/Block',
  block: 'Tower/Block',
  floor: 'Floor',
  'unit number': 'Unit Number',
  unit: 'Unit Number',
  flat: 'Unit Number',
  'flat number': 'Unit Number',
  'resident name': 'Resident Name',
  name: 'Resident Name',
  'mobile number': 'Mobile Number',
  mobile: 'Mobile Number',
  phone: 'Mobile Number',
  email: 'Email',
  relationship: 'Relationship',
  occupancy: 'Relationship',
  'primary resident': 'Primary Resident',
  primary: 'Primary Resident',
  'emergency contact name': 'Emergency Contact Name',
  'emergency contact phone': 'Emergency Contact Phone',
  vehicles: 'Vehicles',
  'vehicle numbers': 'Vehicles',
};

const MAX_ROWS = 5000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

type ParsedCsv = { rows: string[][] };

/**
 * RFC 4180-ish CSV parser: quoted fields, escaped quotes, CRLF/LF and newlines
 * inside quotes. A malformed (unterminated) quote is a validation error.
 */
export function parseCsv(input: string): ParsedCsv {
  const text = input.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      if (field !== '') throw Errors.validation({ csv: 'A quote may only start a field.' }, 'The CSV file is malformed.');
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (quoted) throw Errors.validation({ csv: 'A quoted field is not closed.' }, 'The CSV file is malformed.');
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return { rows };
}

const csvCell = (value: string) => {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

const csvLine = (cells: string[]) => cells.map(csvCell).join(',');

export const IMPORT_TEMPLATE_CSV = `${[
  csvLine([...IMPORT_HEADERS]),
  csvLine(['A', '0', '101', 'Asha Rao', '9876543210', 'asha@example.com', 'OWNER', 'Yes', 'Ravi Rao', '9876500000', 'MH12AB1234; MH12CD5678']),
  csvLine(['A', '1', '201', 'Vikram Shah', '9876543211', '', 'TENANT', 'No', '', '', '']),
  csvLine(['A', '1', '201', 'Meera Shah', '', '', 'HOUSEHOLD', 'No', '', '', '']),
].join('\n')}\n`;

interface StoredImportRow {
  rowNumber: number;
  building: string;
  floor: number | null;
  unitNumber: string;
  residentName: string;
  phone: string | null;
  email: string | null;
  relationship: OccupancyType | null;
  isPrimary: boolean;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  vehicles: string[];
  unitId: string | null;
  residentId: string | null;
  action: ImportRowAction;
  message: string | null;
}

interface ParsedRow extends Omit<StoredImportRow, 'action' | 'message' | 'unitId' | 'residentId'> {
  errors: ImportRowErrorDto[];
}

const trimOrNull = (value: string | undefined) => {
  const v = (value ?? '').trim();
  return v === '' ? null : v;
};

const asBool = (value: string | undefined) => /^(y|yes|true|1)$/i.test((value ?? '').trim());

const uniquePhones = (value: string | undefined) =>
  (value ?? '')
    .split(/[;|]/)
    .map((v) => v.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 10);

function parseRow(rowNumber: number, cells: string[], columns: Map<string, number>): ParsedRow {
  const get = (header: (typeof IMPORT_HEADERS)[number]) => {
    const index = columns.get(header);
    return index === undefined ? undefined : (cells[index] ?? '').trim();
  };
  const errors: ImportRowErrorDto[] = [];
  const add = (field: string, message: string) => errors.push({ rowNumber, field, message });

  const building = get('Tower/Block') ?? '';
  const unitNumber = (get('Unit Number') ?? '').toUpperCase();
  const residentName = get('Resident Name') ?? '';
  const relationshipRaw = (get('Relationship') ?? '').toUpperCase();
  const relationship = OCCUPANCY_TYPES.includes(relationshipRaw as OccupancyType) ? (relationshipRaw as OccupancyType) : null;
  const floorRaw = get('Floor') ?? '';
  const phoneRaw = get('Mobile Number') ?? '';
  const emailRaw = get('Email') ?? '';
  const emergencyPhoneRaw = get('Emergency Contact Phone') ?? '';

  if (!building) add('Tower/Block', 'Tower / block is required');
  if (!unitNumber) add('Unit Number', 'Unit number is required');
  else if (!/^[A-Z0-9][A-Z0-9/-]{0,9}$/.test(unitNumber)) add('Unit Number', 'Use letters, numbers, - or / (max 10)');
  if (!residentName) add('Resident Name', 'Resident name is required');
  else if (residentName.length < 2 || residentName.length > 80) add('Resident Name', 'Name must be 2–80 characters');
  if (!relationship) add('Relationship', 'Choose OWNER, TENANT or HOUSEHOLD');

  let floor: number | null = null;
  if (floorRaw !== '') {
    const parsed = Number(floorRaw);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 200) add('Floor', 'Floor must be a whole number between 0 and 200');
    else floor = parsed;
  }

  let phone: string | null = null;
  if (phoneRaw !== '') {
    phone = normalizeIndianMobile(phoneRaw);
    if (!phone) add('Mobile Number', 'Enter a valid 10-digit Indian mobile number');
  }

  let email: string | null = null;
  if (emailRaw !== '') {
    email = emailRaw.toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) add('Email', 'Enter a valid email address');
  }

  let emergencyContactPhone: string | null = null;
  if (emergencyPhoneRaw !== '') {
    emergencyContactPhone = normalizeIndianMobile(emergencyPhoneRaw);
    if (!emergencyContactPhone) add('Emergency Contact Phone', 'Enter a valid 10-digit Indian mobile number');
  }

  return {
    rowNumber,
    building,
    floor,
    unitNumber,
    residentName,
    phone,
    email,
    relationship,
    isPrimary: asBool(get('Primary Resident')),
    emergencyContactName: trimOrNull(get('Emergency Contact Name')),
    emergencyContactPhone,
    vehicles: uniquePhones(get('Vehicles')),
    errors,
  };
}

function columnsFrom(header: string[]): Map<string, number> {
  const columns = new Map<string, number>();
  header.forEach((raw, index) => {
    const key = raw.trim().toLowerCase();
    const canonical = HEADER_ALIASES[key];
    if (canonical && !columns.has(canonical)) columns.set(canonical, index);
  });
  const missing = IMPORT_HEADERS.filter((h) => !columns.has(h));
  if (missing.length > 0) {
    throw Errors.validation(
      { csv: `Missing column(s): ${missing.join(', ')}` },
      'The CSV header does not match the template. Download the template and try again.',
    );
  }
  return columns;
}

const toPreviewRow = (row: StoredImportRow): ImportPreviewRowDto => ({  rowNumber: row.rowNumber,
  action: row.action,
  building: row.building,
  floor: row.floor,
  unitNumber: row.unitNumber,
  residentName: row.residentName,
  relationship: row.relationship,
  message: row.message,
});

export function toImportJobDto(job: ResidentImportJob, alreadyProcessed = false): ResidentImportJobDto {
  const rows = Array.isArray(job.rows) ? (job.rows as unknown as StoredImportRow[]) : [];
  const errors = Array.isArray(job.errors) ? (job.errors as unknown as ImportRowErrorDto[]) : [];
  return {
    id: job.id,
    societyId: job.societyId,
    fileName: job.fileName,
    status: job.status as ImportJobStatus,
    totalRows: job.totalRows,
    validRows: job.validRows,
    invalidRows: job.invalidRows,
    duplicateRows: job.duplicateRows,
    createdRows: job.createdRows,
    updatedRows: job.updatedRows,
    skippedRows: job.skippedRows,
    rejectedRows: job.rejectedRows,
    errors,
    rows: rows.map(toPreviewRow),
    failureReason: job.failureReason,
    alreadyProcessed,
    createdAt: job.createdAt.toISOString(),
    confirmedAt: job.confirmedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
  };
}

/** Builds the formula-safe error report for a finished (or previewed) job. */
export function toErrorReportCsv(job: ResidentImportJob): string {
  const rows = Array.isArray(job.rows) ? (job.rows as unknown as StoredImportRow[]) : [];
  const errors = Array.isArray(job.errors) ? (job.errors as unknown as ImportRowErrorDto[]) : [];
  const byRow = new Map(rows.map((r) => [r.rowNumber, r]));
  const lines = [csvLine(['Row', 'Field', 'Message', 'Tower/Block', 'Floor', 'Unit Number', 'Resident Name', 'Mobile Number', 'Relationship', 'Action'])];
  for (const error of errors) {
    const row = byRow.get(error.rowNumber);
    lines.push(
      csvLine([
        String(error.rowNumber),
        error.field,
        error.message,
        row?.building ?? '',
        row?.floor === null || row?.floor === undefined ? '' : String(row.floor),
        row?.unitNumber ?? '',
        row?.residentName ?? '',
        row?.phone ?? '',
        row?.relationship ?? '',
        row?.action ?? '',
      ]),
    );
  }
  // A rejected row without a field error still appears in the report.
  for (const row of rows) {
    if (row.action !== 'REJECT') continue;
    if (errors.some((e) => e.rowNumber === row.rowNumber)) continue;
    lines.push(
      csvLine([
        String(row.rowNumber),
        'Row',
        row.message ?? 'Rejected',
        row.building,
        row.floor === null ? '' : String(row.floor),
        row.unitNumber,
        row.residentName,
        row.phone ?? '',
        row.relationship ?? '',
        row.action,
      ]),
    );
  }
  return `${lines.join('\n')}\n`;
}

@Injectable()
export class ResidentImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async preview(societyId: string, actorUserId: string, fileName: string, csv: string): Promise<ResidentImportJobDto> {
    if (Buffer.byteLength(csv, 'utf8') > MAX_FILE_BYTES) {
      throw Errors.validation({ csv: 'The file is larger than 2 MB.' }, 'The CSV file is too large.');
    }
    const fileHash = createHash('sha256').update(csv, 'utf8').digest('hex');
    const existing = await this.prisma.residentImportJob.findUnique({ where: { societyId_fileHash: { societyId, fileHash } } });
    if (existing) return toImportJobDto(existing, true);

    const { rows: parsedCsv } = parseCsv(csv);
    const headerIndex = parsedCsv.findIndex((r) => r.some((cell) => cell.trim() !== ''));
    if (headerIndex === -1) throw Errors.validation({ csv: 'The file is empty.' }, 'The CSV file is empty.');
    const columns = columnsFrom(parsedCsv[headerIndex]);
    const dataRows = parsedCsv.slice(headerIndex + 1).filter((r) => r.some((cell) => cell.trim() !== ''));
    if (dataRows.length === 0) throw Errors.validation({ csv: 'The file has no data rows.' }, 'The CSV file has no data rows.');
    if (dataRows.length > MAX_ROWS) throw Errors.validation({ csv: `At most ${MAX_ROWS} rows per import.` }, 'The CSV file has too many rows.');

    const [buildings, units] = await Promise.all([
      this.prisma.building.findMany({ where: { societyId }, select: { id: true, name: true, archivedAt: true } }),
      this.prisma.unit.findMany({
        where: { societyId },
        select: { id: true, number: true, status: true, buildingId: true, floorId: true, floor: { select: { level: true } } },
      }),
    ]);
    const buildingByName = new Map(buildings.map((b) => [b.name.toLowerCase(), b]));
    const unitByKey = new Map(units.map((u) => [`${u.buildingId}|${u.number}`, u]));

    const parsed = dataRows.map((cells, index) => parseRow(index + 2, cells, columns));
    const phoneSeen = new Map<string, { name: string; rowNumber: number }>();
    const primarySeen = new Set<string>();
    const errors: ImportRowErrorDto[] = [];
    const stored: StoredImportRow[] = [];

    for (const row of parsed) {
      errors.push(...row.errors);
      let action: ImportRowAction = row.errors.length > 0 ? 'REJECT' : 'CREATE';
      let message: string | null = row.errors.length > 0 ? row.errors[0].message : null;
      let unitId: string | null = null;
      let residentId: string | null = null;

      if (action !== 'REJECT') {
        const building = buildingByName.get(row.building.toLowerCase());
        const unit = building ? unitByKey.get(`${building.id}|${row.unitNumber}`) : undefined;
        if (!building || building.archivedAt) {
          action = 'REJECT';
          message = 'Tower / block is not in this society.';
          errors.push({ rowNumber: row.rowNumber, field: 'Tower/Block', message });
        } else if (!unit) {
          action = 'REJECT';
          message = 'Unit is not in this society. Add the unit first.';
          errors.push({ rowNumber: row.rowNumber, field: 'Unit Number', message });
        } else if (unit.status !== 'ACTIVE') {
          action = 'REJECT';
          message = 'Unit is archived. Restore it before importing residents.';
          errors.push({ rowNumber: row.rowNumber, field: 'Unit Number', message });
        } else if (row.floor !== null && unit.floor && unit.floor.level !== row.floor) {
          action = 'REJECT';
          message = `Unit is on floor ${unit.floor.level}, not ${row.floor}.`;
          errors.push({ rowNumber: row.rowNumber, field: 'Floor', message });
        } else {
          unitId = unit.id;
        }
      }

      if (action !== 'REJECT' && row.phone) {
        const seen = phoneSeen.get(row.phone);
        if (seen) {
          if (seen.name.toLowerCase() !== row.residentName.toLowerCase()) {
            action = 'REJECT';
            message = `Mobile number is already used on row ${seen.rowNumber} by ${seen.name}.`;
            errors.push({ rowNumber: row.rowNumber, field: 'Mobile Number', message });
          } else if (unitId && primarySeen.has(unitId) && row.isPrimary) {
            action = 'REJECT';
            message = 'Another row already marks a primary resident for this unit.';
            errors.push({ rowNumber: row.rowNumber, field: 'Primary Resident', message });
          }
        } else {
          phoneSeen.set(row.phone, { name: row.residentName, rowNumber: row.rowNumber });
        }

        if (action !== 'REJECT') {
          const resident = await this.prisma.resident.findFirst({
            where: { societyId, phone: row.phone },
            include: { units: { where: { endedAt: null } } },
          });
          if (resident) {
            residentId = resident.id;
            if (resident.fullName.trim().toLowerCase() !== row.residentName.trim().toLowerCase()) {
              action = 'REJECT';
              message = `A resident with this mobile number is already recorded as ${resident.fullName}.`;
              errors.push({ rowNumber: row.rowNumber, field: 'Resident Name', message });
            } else if (unitId && resident.units.some((u) => u.unitId === unitId)) {
              action = 'SKIP';
              message = 'This resident is already linked to this unit.';
            } else if (
              (resident.email && row.email && resident.email.toLowerCase() !== row.email) ||
              (resident.emergencyContactName && row.emergencyContactName && resident.emergencyContactName !== row.emergencyContactName) ||
              (resident.emergencyContactPhone && row.emergencyContactPhone && resident.emergencyContactPhone !== row.emergencyContactPhone)
            ) {
              action = 'REJECT';
              message = 'The row would overwrite existing resident details. Edit the resident record instead.';
              errors.push({ rowNumber: row.rowNumber, field: 'Resident Name', message });
            } else {
              action = 'UPDATE';
              message = 'Resident exists; the unit will be added.';
            }
          }
        }
      }

      if (action === 'CREATE' && unitId && primarySeen.has(unitId) && row.isPrimary) {
        action = 'REJECT';
        message = 'Another row already marks a primary resident for this unit.';
        errors.push({ rowNumber: row.rowNumber, field: 'Primary Resident', message });
      }
      if (unitId && row.isPrimary && action !== 'REJECT') primarySeen.add(unitId);

      stored.push({
        rowNumber: row.rowNumber,
        building: row.building,
        floor: row.floor,
        unitNumber: row.unitNumber,
        residentName: row.residentName,
        phone: row.phone,
        email: row.email,
        relationship: row.relationship,
        isPrimary: row.isPrimary,
        emergencyContactName: row.emergencyContactName,
        emergencyContactPhone: row.emergencyContactPhone,
        vehicles: row.vehicles,
        unitId,
        residentId,
        action,
        message,
      });
    }

    const counts = {
      totalRows: stored.length,
      validRows: stored.filter((r) => r.action === 'CREATE' || r.action === 'UPDATE').length,
      invalidRows: stored.filter((r) => r.action === 'REJECT').length,
      duplicateRows: stored.filter((r) => r.action === 'SKIP').length,
    };
    try {
      const job = await this.prisma.residentImportJob.create({
        data: {
          societyId,
          createdById: actorUserId,
          fileName: fileName.slice(0, 120),
          fileHash,
          status: 'PREVIEWED',
          ...counts,
          rows: stored as unknown as Prisma.InputJsonValue,
          errors: errors as unknown as Prisma.InputJsonValue,
        },
      });
      await this.audit.record({
        action: 'resident.import.previewed',
        outcome: 'SUCCESS',
        actorUserId,
        societyId,
        targetType: 'resident_import',
        targetId: job.id,
        metadata: { ...counts, fileName: job.fileName },
      });
      return toImportJobDto(job);
    } catch (err) {
      // A concurrent identical upload won the unique (society, fileHash) race.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const job = await this.prisma.residentImportJob.findUniqueOrThrow({ where: { societyId_fileHash: { societyId, fileHash } } });
        return toImportJobDto(job, true);
      }
      throw err;
    }
  }

  async confirm(societyId: string, actorUserId: string, jobId: string): Promise<ResidentImportJobDto> {
    const job = await this.prisma.residentImportJob.findFirst({ where: { id: jobId, societyId } });
    if (!job) throw Errors.notFound('Import not found.');
    if (job.status === 'COMPLETED') return toImportJobDto(job, true);
    if (job.status === 'FAILED') throw Errors.conflict('This import failed. Upload the file again.');
    if (job.status === 'IMPORTING') throw Errors.conflict('This import is already running.');

    const claimed = await this.prisma.residentImportJob.updateMany({
      where: { id: job.id, societyId, status: 'PREVIEWED' },
      data: { status: 'IMPORTING', confirmedAt: new Date() },
    });
    if (claimed.count === 0) {
      const current = await this.prisma.residentImportJob.findFirstOrThrow({ where: { id: job.id, societyId } });
      if (current.status === 'COMPLETED') return toImportJobDto(current, true);
      throw Errors.conflict('This import is already running.');
    }

    const previewRows = Array.isArray(job.rows) ? (job.rows as unknown as StoredImportRow[]) : [];
    const errors: ImportRowErrorDto[] = Array.isArray(job.errors) ? [...(job.errors as unknown as ImportRowErrorDto[])] : [];
    const rows: StoredImportRow[] = [];
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let rejected = 0;

    try {
      await this.prisma.$transaction(async (tx) => {
        for (const row of previewRows) {
          const reject = (field: string, message: string) => {
            rejected += 1;
            rows.push({ ...row, action: 'REJECT', message });
            errors.push({ rowNumber: row.rowNumber, field, message });
          };
          if (row.action === 'REJECT') {
            reject('Row', row.message ?? 'Rejected during preview');
            continue;
          }
          if (row.action === 'SKIP') {
            skipped += 1;
            rows.push(row);
            continue;
          }
          if (!row.unitId || !row.relationship) {
            reject('Row', 'The preview data is incomplete.');
            continue;
          }
          const unit = await tx.unit.findFirst({
            where: { id: row.unitId, societyId },
            include: { floor: { select: { level: true } } },
          });
          if (!unit || unit.status !== 'ACTIVE') {
            reject('Unit Number', 'The unit is no longer active.');
            continue;
          }
          if (row.floor !== null && unit.floor && unit.floor.level !== row.floor) {
            reject('Floor', `Unit is on floor ${unit.floor.level}, not ${row.floor}.`);
            continue;
          }

          let resident = row.residentId
            ? await tx.resident.findFirst({ where: { id: row.residentId, societyId } })
            : null;
          if (!resident && row.phone) {
            resident = await tx.resident.findFirst({ where: { societyId, phone: row.phone } });
          }
          if (resident && resident.fullName.trim().toLowerCase() !== row.residentName.trim().toLowerCase()) {
            reject('Resident Name', `A resident with this mobile number is already recorded as ${resident.fullName}.`);
            continue;
          }

          if (resident) {
            const duplicate = await tx.residentUnit.findFirst({
              where: { residentId: resident.id, unitId: unit.id, endedAt: null },
            });
            if (duplicate) {
              skipped += 1;
              rows.push({ ...row, residentId: resident.id, action: 'SKIP', message: 'This resident is already linked to this unit.' });
              continue;
            }
            const patch: Prisma.ResidentUpdateInput = {};
            if (!resident.email && row.email) patch.email = row.email;
            if (!resident.emergencyContactName && row.emergencyContactName) patch.emergencyContactName = row.emergencyContactName;
            if (!resident.emergencyContactPhone && row.emergencyContactPhone) patch.emergencyContactPhone = row.emergencyContactPhone;
            const existingVehicles = Array.isArray(resident.vehicles) ? (resident.vehicles as unknown[]) : [];
            if (existingVehicles.length === 0 && row.vehicles.length > 0) {
              patch.vehicles = row.vehicles as unknown as Prisma.InputJsonValue;
            }
            if (Object.keys(patch).length > 0) resident = await tx.resident.update({ where: { id: resident.id }, data: patch });
            updated += 1;
          } else {
            const linkedUser = row.phone ? await tx.user.findUnique({ where: { phone: row.phone }, select: { id: true } }) : null;
            resident = await tx.resident.create({
              data: {
                societyId,
                userId: linkedUser?.id ?? null,
                fullName: row.residentName,
                phone: row.phone,
                email: row.email,
                emergencyContactName: row.emergencyContactName,
                emergencyContactPhone: row.emergencyContactPhone,
                vehicles: row.vehicles as unknown as Prisma.InputJsonValue,
                createdById: actorUserId,
              },
            });
            created += 1;
          }

          if (row.isPrimary) {
            await tx.residentUnit.updateMany({
              where: { societyId, unitId: unit.id, endedAt: null, isPrimary: true },
              data: { isPrimary: false },
            });
          }
          await tx.residentUnit.create({
            data: {
              societyId,
              residentId: resident.id,
              unitId: unit.id,
              relationship: row.relationship,
              isPrimary: row.isPrimary,
              createdById: actorUserId,
            },
          });
          rows.push({ ...row, residentId: resident.id, action: row.action === 'CREATE' ? 'CREATE' : 'UPDATE' });
        }

        const finalCounts = {
          totalRows: rows.length,
          validRows: created + updated,
          invalidRows: rejected,
          duplicateRows: skipped,
          createdRows: created,
          updatedRows: updated,
          skippedRows: skipped,
          rejectedRows: rejected,
        };
        await tx.residentImportJob.update({
          where: { id: job.id },
          data: {
            ...finalCounts,
            status: 'COMPLETED',
            completedAt: new Date(),
            rows: rows as unknown as Prisma.InputJsonValue,
            errors: errors as unknown as Prisma.InputJsonValue,
          },
        });
        await this.audit.record(
          {
            action: 'resident.import.completed',
            outcome: 'SUCCESS',
            actorUserId,
            societyId,
            targetType: 'resident_import',
            targetId: job.id,
            metadata: finalCounts,
          },
          tx,
        );
      });
      const completed = await this.prisma.residentImportJob.findUniqueOrThrow({ where: { id: job.id } });
      return toImportJobDto(completed);
    } catch (err) {
      const reason = (err as Error).message.slice(0, 280);
      await this.prisma.residentImportJob.update({
        where: { id: job.id },
        data: { status: 'FAILED', failureReason: reason, completedAt: new Date() },
      });
      await this.audit.record({
        action: 'resident.import.failed',
        outcome: 'FAILURE',
        actorUserId,
        societyId,
        targetType: 'resident_import',
        targetId: job.id,
        metadata: { reason },
      });
      throw Errors.conflict('The import failed and nothing was saved. Upload the file again.');
    }
  }
}
