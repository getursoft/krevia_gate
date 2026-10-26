import { Injectable } from '@nestjs/common';
import type { MemberRole, MemberStatus, Membership, OccupancyType, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors';
import { endResidentAssignment, syncResidentAssignment } from '../residents/resident-sync';

type Tx = Prisma.TransactionClient;

/**
 * Membership state changes shared by invitations, join-request approval and
 * admin status management. All methods run inside the caller's transaction and
 * write their audit events in that same transaction.
 */
@Injectable()
export class MembershipLifecycleService {
  constructor(private readonly audit: AuditService) {}

  /**
   * Makes (user, society, role) ACTIVE. A REVOKED membership is re-activated; a
   * SUSPENDED one is never silently re-activated (an admin must do that).
   */
  async activate(
    tx: Tx,
    input: { userId: string; societyId: string; role: MemberRole; invitationId?: string; actorUserId: string | null },
  ): Promise<Membership> {
    const existing = await tx.membership.findUnique({
      where: { userId_societyId_role: { userId: input.userId, societyId: input.societyId, role: input.role } },
    });
    if (existing?.status === 'SUSPENDED') {
      throw Errors.conflict('This membership is suspended. Ask a society administrator to reactivate it.');
    }
    if (existing?.status === 'ACTIVE') return existing;
    const membership = existing
      ? await tx.membership.update({
          where: { id: existing.id },
          data: {
            status: 'ACTIVE',
            invitationId: input.invitationId ?? null,
            statusChangedAt: new Date(),
            statusChangedById: input.actorUserId,
          },
        })
      : await tx.membership.create({
          data: {
            userId: input.userId,
            societyId: input.societyId,
            role: input.role,
            status: 'ACTIVE',
            invitationId: input.invitationId ?? null,
          },
        });
    await this.audit.record(
      {
        action: 'membership.created',
        outcome: 'SUCCESS',
        actorUserId: input.actorUserId,
        societyId: input.societyId,
        targetType: 'membership',
        targetId: membership.id,
        metadata: { role: input.role, via: input.invitationId ? 'invitation' : 'join_request', reactivated: Boolean(existing) },
      },
      tx,
    );
    return membership;
  }

  /**
   * Assigns a unit to a RESIDENT membership. Both are looked up inside the same
   * society (and the composite foreign keys enforce it again in the database).
   */
  async assignUnit(
    tx: Tx,
    input: { societyId: string; unitId: string; membershipId: string; occupancy: OccupancyType; actorUserId: string | null },
  ) {
    const [unit, membership] = await Promise.all([
      tx.unit.findFirst({ where: { id: input.unitId, societyId: input.societyId } }),
      tx.membership.findFirst({ where: { id: input.membershipId, societyId: input.societyId } }),
    ]);
    if (!unit) throw Errors.notFound('Unit not found.');
    if (unit.status !== 'ACTIVE') throw Errors.conflict('This unit is archived. Restore it before assigning residents.');
    if (!membership) throw Errors.notFound('Member not found.');
    if (membership.role !== 'RESIDENT' || membership.status !== 'ACTIVE') {
      throw Errors.conflict('Units can only be assigned to active resident memberships.');
    }
    const current = await tx.unitAssignment.findFirst({
      where: { membershipId: membership.id, unitId: unit.id, endedAt: null },
      include: { unit: true },
    });
    if (current) return current;
    const assignment = await tx.unitAssignment.create({
      data: {
        societyId: input.societyId,
        unitId: unit.id,
        membershipId: membership.id,
        occupancy: input.occupancy,
        assignedById: input.actorUserId,
      },
      include: { unit: true },
    });
    await this.audit.record(
      {
        action: 'unit.assigned',
        outcome: 'SUCCESS',
        actorUserId: input.actorUserId,
        societyId: input.societyId,
        targetType: 'unit',
        targetId: unit.id,
        metadata: { membershipId: membership.id, assignmentId: assignment.id, occupancy: input.occupancy },
      },
      tx,
    );
    await syncResidentAssignment(tx, assignment.id, input.actorUserId);
    return assignment;
  }

  /** ACTIVE ⇄ SUSPENDED, and ACTIVE/SUSPENDED → REVOKED (terminal). */
  async changeStatus(
    tx: Tx,
    membership: Membership,
    to: MemberStatus,
    input: { actorUserId: string; reason?: string },
  ): Promise<Membership> {
    if (membership.status === to) return membership;
    if (membership.status === 'REVOKED') {
      throw Errors.conflict('A revoked membership cannot be changed. Send a new invitation instead.');
    }
    if (membership.role === 'ADMIN' && membership.status === 'ACTIVE') {
      const otherAdmins = await tx.membership.count({
        where: { societyId: membership.societyId, role: 'ADMIN', status: 'ACTIVE', NOT: { id: membership.id } },
      });
      if (otherAdmins === 0) throw Errors.conflict('A society must keep at least one active administrator.');
    }
    // Conditional update: a concurrent change to the same membership cannot be lost silently.
    const updated = await tx.membership.updateMany({
      where: { id: membership.id, status: membership.status },
      data: { status: to, statusChangedAt: new Date(), statusChangedById: input.actorUserId },
    });
    if (updated.count === 0) throw Errors.conflict('This membership was changed by someone else. Reload and try again.');

    if (to === 'REVOKED') {
      const now = new Date();
      const activeAssignments = await tx.unitAssignment.findMany({
        where: { membershipId: membership.id, endedAt: null },
        select: { id: true },
      });
      await tx.unitAssignment.updateMany({
        where: { membershipId: membership.id, endedAt: null },
        data: { endedAt: now, endedById: input.actorUserId },
      });
      for (const assignment of activeAssignments) await endResidentAssignment(tx, assignment.id);
      if (membership.role === 'RESIDENT') {
        // Frees the "one open request per user" index so the person can re-apply later.
        await tx.membershipRequest.updateMany({
          where: { userId: membership.userId, societyId: membership.societyId, status: 'APPROVED' },
          data: { status: 'REVOKED' },
        });
      }
    }
    await this.audit.record(
      {
        action: 'membership.status_changed',
        outcome: 'SUCCESS',
        actorUserId: input.actorUserId,
        societyId: membership.societyId,
        targetType: 'membership',
        targetId: membership.id,
        metadata: { role: membership.role, from: membership.status, to, ...(input.reason && { reason: input.reason }) },
      },
      tx,
    );
    return tx.membership.findUniqueOrThrow({ where: { id: membership.id } });
  }
}
