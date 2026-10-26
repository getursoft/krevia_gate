import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { indianMobileSchema } from '@krevia/shared';
import { z } from 'zod';
import { Public } from '../auth/auth.guard';
import { validate } from '../common/validate';
import { DevOutboxSender, MESSAGE_SENDER } from './message-sender';

const querySchema = z.object({ to: indianMobileSchema });

/**
 * Development-safe delivery: lets a developer (or the e2e suite) read the
 * invitation links and reset codes that a real SMS provider would send.
 * Only registered when MESSAGE_DELIVERY=dev-outbox, which config rejects in
 * production.
 */
@ApiExcludeController()
@Controller('dev/outbox')
export class DevOutboxController {
  constructor(@Inject(MESSAGE_SENDER) private readonly sender: DevOutboxSender) {}

  @Public()
  @Get()
  list(@Query() query: unknown) {
    const { to } = validate(querySchema, query);
    return { items: this.sender.messagesFor(to) };
  }
}
