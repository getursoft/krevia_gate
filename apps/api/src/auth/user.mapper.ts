import type { User } from '@prisma/client';
import type { UserDto } from '@krevia/shared';
import { PrismaService } from '../prisma/prisma.service';

/** Public user shape. Never includes passwordHash. */
export async function toUserDto(prisma: PrismaService, user: User): Promise<UserDto> {
  const roles = await prisma.societyRole.findMany({
    where: { userId: user.id },
    select: { societyId: true, role: true, society: { select: { name: true, city: true, state: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return {
    id: user.id,
    fullName: user.fullName,
    phone: user.phone,
    email: user.email,
    platformRole: user.platformRole,
    adminSocietyIds: roles.filter((r) => r.role === 'ADMIN').map((r) => r.societyId),
    guardSocietyIds: roles.filter((r) => r.role === 'GUARD').map((r) => r.societyId),
    societyRoles: roles.map((r) => ({
      societyId: r.societyId,
      societyName: r.society.name,
      city: r.society.city,
      state: r.society.state,
      role: r.role,
    })),
    createdAt: user.createdAt.toISOString(),
  };
}
