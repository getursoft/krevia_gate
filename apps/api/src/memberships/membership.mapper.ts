import type { MembershipRequest, Society, Unit, User } from '@prisma/client';
import type { AdminMembershipRequestDto, MembershipRequestDto } from '@krevia/shared';
import { toSocietySummary } from '../societies/society.mapper';

export type RequestWithRelations = MembershipRequest & { society: Society; unit: Unit };
export type RequestWithApplicant = RequestWithRelations & { user: User };

export const membershipInclude = { society: true, unit: true } as const;
export const adminMembershipInclude = { society: true, unit: true, user: true } as const;

export const toMembershipDto = (r: RequestWithRelations): MembershipRequestDto => ({
  id: r.id,
  status: r.status,
  occupancy: r.occupancy,
  tower: r.unit.tower,
  unitNumber: r.unit.number,
  society: toSocietySummary(r.society),
  reviewNote: r.reviewNote,
  reviewedAt: r.reviewedAt?.toISOString() ?? null,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

export const toAdminMembershipDto = (r: RequestWithApplicant): AdminMembershipRequestDto => ({
  ...toMembershipDto(r),
  applicant: { id: r.user.id, fullName: r.user.fullName, phone: r.user.phone },
});
