import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/**
 * Keeps the resident directory in sync when an authenticated unit assignment is
 * created. The assignment remains the authorisation/occupancy source; the
 * directory row is the society-facing record of the person.
 *
 * Deliberately a plain function (not a Nest provider) so both ResidentsService
 * and MembershipLifecycleService can call it without a circular dependency.
 */
export async function syncResidentAssignment(tx: Tx, assignmentId: string, actorUserId: string | null): Promise<void> {
  const assignment = await tx.unitAssignment.findUnique({
    where: { id: assignmentId },
    include: { membership: { include: { user: true } }, unit: true },
  });
  if (!assignment) return;
  const user = assignment.membership.user;
  let resident = await tx.resident.findFirst({ where: { societyId: assignment.societyId, userId: user.id } });
  if (!resident && user.phone) {
    const byPhone = await tx.resident.findFirst({ where: { societyId: assignment.societyId, phone: user.phone } });
    if (byPhone && !byPhone.userId) {
      resident = await tx.resident.update({ where: { id: byPhone.id }, data: { userId: user.id } });
    } else {
      resident = byPhone;
    }
  }
  if (!resident) {
    resident = await tx.resident.create({
      data: {
        societyId: assignment.societyId,
        userId: user.id,
        fullName: user.fullName,
        phone: user.phone,
        email: user.email,
        createdById: actorUserId,
      },
    });
  }
  const existing = await tx.residentUnit.findFirst({ where: { assignmentId } });
  if (existing) return;
  const duplicate = await tx.residentUnit.findFirst({
    where: { residentId: resident.id, unitId: assignment.unitId, endedAt: null },
  });
  if (duplicate) {
    await tx.residentUnit.update({ where: { id: duplicate.id }, data: { assignmentId } });
    return;
  }
  await tx.residentUnit.create({
    data: {
      societyId: assignment.societyId,
      residentId: resident.id,
      unitId: assignment.unitId,
      relationship: assignment.occupancy,
      assignmentId,
      createdById: actorUserId,
    },
  });
}

/** Ends the directory link when an authenticated assignment ends. */
export async function endResidentAssignment(tx: Tx, assignmentId: string): Promise<void> {
  await tx.residentUnit.updateMany({ where: { assignmentId, endedAt: null }, data: { endedAt: new Date() } });
}
