import type { User } from '@prisma/client';
import type { UserDto } from '@krevia/shared';
import { PrismaService } from '../prisma/prisma.service';

/** Public user shape. Never includes passwordHash. Staff roles are ACTIVE memberships only. */
export async function toUserDto(prisma: PrismaService, user: User): Promise<UserDto> {
  const memberships = await prisma.membership.findMany({
    where: { userId: user.id },
    select: { id: true, societyId: true, role: true, status: true, society: { select: { name: true, city: true, state: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const staff = memberships.filter((m) => m.status === 'ACTIVE' && m.role !== 'RESIDENT');
  return {
    id: user.id,
    fullName: user.fullName,
    phone: user.phone,
    email: user.email,
    platformRole: user.platformRole,
    adminSocietyIds: staff.filter((m) => m.role === 'ADMIN').map((m) => m.societyId),
    guardSocietyIds: staff.filter((m) => m.role === 'GUARD').map((m) => m.societyId),
    societyRoles: staff.map((m) => ({
      societyId: m.societyId,
      societyName: m.society.name,
      city: m.society.city,
      state: m.society.state,
      role: m.role as 'ADMIN' | 'GUARD',
    })),
    memberships: memberships.map((m) => ({
      id: m.id,
      societyId: m.societyId,
      societyName: m.society.name,
      city: m.society.city,
      role: m.role,
      status: m.status,
    })),
    createdAt: user.createdAt.toISOString(),
  };
}

/** "+91******3210": enough to recognise a number without exposing it. */
export const maskPhone = (phone: string) => `${phone.slice(0, 3)}******${phone.slice(-4)}`;
