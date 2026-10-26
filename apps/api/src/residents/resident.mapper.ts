import type { Building, Prisma, Resident, ResidentUnit, Unit } from '@prisma/client';
import type { ResidentDto, ResidentUnitDto, VehicleDto } from '@krevia/shared';
import { maskPhone } from '../auth/user.mapper';

export const residentInclude = {
  units: {
    include: { unit: { include: { building: true, floor: true } } },
    orderBy: [{ endedAt: 'asc' }, { startedAt: 'asc' }],
  },
} satisfies Prisma.ResidentInclude;

type ResidentRow = Resident & {
  units: (ResidentUnit & { unit: Unit & { building: Building; floor: { level: number; name: string | null } | null } })[];
};

const vehicles = (value: Prisma.JsonValue): VehicleDto[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return [];
    const number = typeof item.number === 'string' ? item.number : null;
    if (!number) return [];
    return [{ number, ...(typeof item.type === 'string' ? { type: item.type } : {}) }];
  });
};

export const toResidentUnitDto = (ru: ResidentRow['units'][number]): ResidentUnitDto => ({
  id: ru.id,
  unitId: ru.unitId,
  buildingId: ru.unit.buildingId,
  buildingName: ru.unit.building.name,
  tower: ru.unit.building.name,
  number: ru.unit.number,
  floorId: ru.unit.floorId,
  floorLevel: ru.unit.floor?.level ?? null,
  relationship: ru.relationship,
  isPrimary: ru.isPrimary,
  startedAt: ru.startedAt.toISOString(),
  endedAt: ru.endedAt?.toISOString() ?? null,
});

export const toResidentDto = (r: ResidentRow): ResidentDto => ({
  id: r.id,
  societyId: r.societyId,
  userId: r.userId,
  fullName: r.fullName,
  phone: r.phone,
  email: r.email,
  status: r.status,
  emergencyContactName: r.emergencyContactName,
  emergencyContactPhone: r.emergencyContactPhone,
  vehicles: vehicles(r.vehicles),
  units: r.units.map(toResidentUnitDto),
  archivedAt: r.archivedAt?.toISOString() ?? null,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

/** Household rows never expose full phone numbers or emergency contacts to another resident. */
export const toHouseholdMember = (r: Pick<Resident, 'id' | 'fullName' | 'phone'>, relationship: ResidentUnit['relationship']) => ({
  id: r.id,
  fullName: r.fullName,
  relationship,
  maskedPhone: r.phone ? maskPhone(r.phone) : null,
});

export type ResidentRowWithUnits = ResidentRow;
