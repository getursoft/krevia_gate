import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { updateProfileSchema } from '@krevia/shared';
import { CurrentSession } from '../auth/auth.guard';
import type { SessionWithUser } from '../auth/session.service';
import { toUserDto } from '../auth/user.mapper';
import { Errors } from '../common/errors';
import { jsonSchema } from '../common/openapi';
import { validate } from '../common/validate';
import { PrismaService } from '../prisma/prisma.service';

/** A user can only read and modify their own profile; the id always comes from the session. */
@ApiTags('profile')
@Controller('profile')
export class ProfileController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Get my profile' })
  async get(@CurrentSession() session: SessionWithUser) {
    return { user: await toUserDto(this.prisma, session.user) };
  }

  @Patch()
  @ApiOperation({ summary: 'Update my full name and/or email (mobile number cannot be changed in Sprint 1)' })
  @ApiBody({ schema: jsonSchema(updateProfileSchema) })
  async update(@CurrentSession() session: SessionWithUser, @Body() body: unknown) {
    const input = validate(updateProfileSchema, body);
    if (input.email) {
      const taken = await this.prisma.user.findFirst({
        where: { email: input.email, NOT: { id: session.userId } },
        select: { id: true },
      });
      if (taken) throw Errors.validation({ email: 'This email address is already linked to another account.' });
    }
    const user = await this.prisma.user.update({
      where: { id: session.userId },
      data: {
        ...(input.fullName !== undefined && { fullName: input.fullName }),
        ...(input.email !== undefined && { email: input.email }),
      },
    });
    return { user: await toUserDto(this.prisma, user) };
  }
}
