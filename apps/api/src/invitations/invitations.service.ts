import { Inject, Injectable } from '@nestjs/common';
import type { MemberRole, OccupancyType, Prisma, User } from '@prisma/client';
import { BRAND, MEMBER_ROLE_LABEL, type CreatedInvitationDto, type InvitationPreviewDto } from '@krevia/shared';
import { randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { hashToken } from '../auth/session.service';
import { maskPhone } from '../auth/user.mapper';
import { Errors } from '../common/errors';
import { APP_CONFIG, type AppConfig } from '../config';
import { toInvitationDto } from '../members/member.mapper';
import { MembershipLifecycleService } from '../members/membership-lifecycle.service';
import { MESSAGE_SENDER, type MessageSender } from '../messaging/message-sender';
import { PrismaService } from '../prisma/prisma.service';

const NOT_VALID = 'This invitation is not valid for your account. Sign in with the mobile number it was sent to.';
const NO_LONGER_VALID = 'This invitation has already been used, was revoked, or has expired. Ask the society for a new one.';
const LINK_INVALID = 'This invitation link is invalid or has expired.';

/**
 * Invitations bind a role (and, for residents, a unit) to a phone number.
 * The token is 256 random bits shown once to the inviter (and handed to the
 * message sender); only its SHA-256 hash is stored. Acceptance requires a
 * signed-in account with that phone number, is single-use (conditional
 * update), and takes the role and unit from the invitation, never from the
 * request.
 */
@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: MembershipLifecycleService,
    private readonly audit: AuditService,
    @Inject(MESSAGE_SENDER) private readonly sender: MessageSender,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async create(input: {
    societyId: string;
    phone: string;
    role: MemberRole;
    unitId?: string;
    occupancy?: OccupancyType;
    actorUserId: string;
    via?: 'society' | 'platform';
  }): Promise<CreatedInvitationDto> {
    const society = await this.prisma.society.findUnique({ where: { id: input.societyId }, select: { id: true, name: true } });
    if (!society) throw Errors.notFound('Society not found.');
    if (input.unitId) {
      // Tenant check: the unit must belong to this society (404 otherwise, never a cross-society reference).
      const unit = await this.prisma.unit.findFirst({ where: { id: input.unitId, societyId: input.societyId }, select: { id: true } });
      if (!unit) throw Errors.notFound('Unit not found.');
    }
    const existing = await this.prisma.membership.findFirst({
      where: { societyId: input.societyId, role: input.role, status: { in: ['ACTIVE', 'SUSPENDED'] }, user: { phone: input.phone } },
      select: { status: true },
    });
    if (existing) {
      throw Errors.conflict(
        existing.status === 'ACTIVE'
          ? `This number is already an active ${MEMBER_ROLE_LABEL[input.role].toLowerCase()} of this society.`
          : 'This number has a suspended membership for this role. Reactivate it instead.',
      );
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.config.inviteTtlMs);
    const invitation = await this.prisma.$transaction(async (tx) => {
      await this.expireStale(tx, input.societyId);
      const pending = await tx.invitation.findFirst({
        where: { societyId: input.societyId, phone: input.phone, role: input.role, status: 'PENDING' },
        select: { id: true },
      });
      if (pending) throw Errors.conflict('An invitation for this number and role is already pending. Revoke it to send a new one.');
      const created = await tx.invitation.create({
        data: {
          societyId: input.societyId,
          phone: input.phone,
          role: input.role,
          unitId: input.unitId ?? null,
          occupancy: input.occupancy ?? null,
          tokenHash: hashToken(token),
          expiresAt,
          createdById: input.actorUserId,
        },
        include: { unit: true },
      });
      await this.audit.record(
        {
          action: input.via === 'platform' ? 'platform.admin_invited' : 'invitation.created',
          outcome: 'SUCCESS',
          actorUserId: input.actorUserId,
          societyId: input.societyId,
          targetType: 'invitation',
          targetId: created.id,
          metadata: { role: input.role, phone: maskPhone(input.phone), expiresAt: expiresAt.toISOString() },
        },
        tx,
      );
      return created;
    });

    const inviteUrl = `${this.config.publicWebUrl}/invite?token=${token}`;
    const delivered = await this.sender.send({
      to: input.phone,
      kind: 'invitation',
      body: `You are invited to join ${society.name} on ${BRAND.name} as ${MEMBER_ROLE_LABEL[input.role]}. Accept: ${inviteUrl}`,
    });
    return { invitation: toInvitationDto(invitation), inviteUrl, delivered, channel: this.sender.name };
  }

  async preview(token: string): Promise<InvitationPreviewDto> {
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { society: true, unit: true },
    });
    if (!invitation || invitation.status !== 'PENDING' || invitation.expiresAt.getTime() <= Date.now()) {
      throw Errors.notFound(LINK_INVALID);
    }
    return {
      society: { id: invitation.society.id, name: invitation.society.name, city: invitation.society.city },
      role: invitation.role,
      unit: invitation.unit ? { tower: invitation.unit.tower, number: invitation.unit.number } : null,
      phone: maskPhone(invitation.phone),
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  async accept(user: User, token: string): Promise<void> {
    const invitation = await this.prisma.invitation.findUnique({ where: { tokenHash: hashToken(token) } });
    const fail = (reason: string, societyId?: string, invitationId?: string) =>
      this.audit.recordLimited(`invite-accept:${user.id}`, {
        action: 'invitation.accept_failed',
        outcome: 'FAILURE',
        actorUserId: user.id,
        societyId: societyId ?? null,
        ...(invitationId && { targetType: 'invitation', targetId: invitationId }),
        metadata: { reason },
      });
    // Unknown token and someone else's invitation look the same to the caller.
    if (!invitation || invitation.phone !== user.phone) {
      await fail(invitation ? 'phone_mismatch' : 'unknown_token', invitation?.societyId, invitation?.id);
      throw Errors.notFound(NOT_VALID);
    }
    if (invitation.status !== 'PENDING') {
      await fail(`status_${invitation.status.toLowerCase()}`, invitation.societyId, invitation.id);
      throw Errors.conflict(NO_LONGER_VALID);
    }
    if (invitation.expiresAt.getTime() <= Date.now()) {
      const expired = await this.prisma.invitation.updateMany({ where: { id: invitation.id, status: 'PENDING' }, data: { status: 'EXPIRED' } });
      if (expired.count) {
        await this.audit.record({
          action: 'invitation.expired',
          outcome: 'FAILURE',
          actorUserId: user.id,
          societyId: invitation.societyId,
          targetType: 'invitation',
          targetId: invitation.id,
          metadata: { detectedOn: 'accept' },
        });
      }
      throw Errors.conflict(NO_LONGER_VALID);
    }

    await this.prisma.$transaction(async (tx) => {
      // Single use: only one concurrent acceptance can flip PENDING → ACCEPTED.
      const claimed = await tx.invitation.updateMany({
        where: { id: invitation.id, status: 'PENDING', expiresAt: { gt: new Date() } },
        data: { status: 'ACCEPTED', acceptedById: user.id, acceptedAt: new Date() },
      });
      if (claimed.count === 0) throw Errors.conflict(NO_LONGER_VALID);
      const membership = await this.lifecycle.activate(tx, {
        userId: user.id,
        societyId: invitation.societyId,
        role: invitation.role,
        invitationId: invitation.id,
        actorUserId: user.id,
      });
      if (invitation.role === 'RESIDENT' && invitation.unitId && invitation.occupancy) {
        await this.lifecycle.assignUnit(tx, {
          societyId: invitation.societyId,
          unitId: invitation.unitId,
          membershipId: membership.id,
          occupancy: invitation.occupancy,
          actorUserId: user.id,
        });
      }
      await this.audit.record(
        {
          action: 'invitation.accepted',
          outcome: 'SUCCESS',
          actorUserId: user.id,
          societyId: invitation.societyId,
          targetType: 'invitation',
          targetId: invitation.id,
          metadata: { role: invitation.role, membershipId: membership.id },
        },
        tx,
      );
    });
  }

  async revoke(societyId: string, invitationId: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const revoked = await tx.invitation.updateMany({
        where: { id: invitationId, societyId, status: 'PENDING' },
        data: { status: 'REVOKED', revokedById: actorUserId, revokedAt: new Date() },
      });
      if (revoked.count === 0) {
        const exists = await tx.invitation.findFirst({ where: { id: invitationId, societyId }, select: { id: true } });
        if (!exists) throw Errors.notFound('Invitation not found.');
        throw Errors.conflict('Only pending invitations can be revoked.');
      }
      await this.audit.record(
        { action: 'invitation.revoked', outcome: 'SUCCESS', actorUserId, societyId, targetType: 'invitation', targetId: invitationId },
        tx,
      );
      return tx.invitation.findUniqueOrThrow({ where: { id: invitationId }, include: { unit: true } });
    });
  }

  /** Marks PENDING invitations past their expiry as EXPIRED (lazy sweep, per society). */
  async expireStale(db: Prisma.TransactionClient | PrismaService, societyId: string) {
    await db.invitation.updateMany({
      where: { societyId, status: 'PENDING', expiresAt: { lte: new Date() } },
      data: { status: 'EXPIRED' },
    });
  }
}
