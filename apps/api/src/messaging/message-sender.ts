import type { AppLogger } from '../common/logger';

/**
 * Integration boundary for SMS / WhatsApp / email delivery of invitations and
 * password-reset codes. No provider credentials exist yet, so two
 * implementations ship:
 *
 * - DevOutboxSender (development and test only): keeps the last messages in
 *   process memory, readable through GET /api/v1/dev/outbox. Nothing is
 *   written to the database or to logs. Config refuses it in production.
 * - UnconfiguredSender (production default): delivers nothing and reports
 *   `false`, so callers can tell the user that delivery is unavailable.
 *
 * A real provider (MSG91, Twilio, AWS SNS, SES…) implements this interface
 * and is bound to MESSAGE_SENDER in AppModule.
 */
export interface OutboundMessage {
  /** E.164 phone number. */
  to: string;
  kind: 'password_reset' | 'invitation';
  body: string;
}

export interface MessageSender {
  readonly name: string;
  /** Resolves true when the message was handed to a delivery channel. */
  send(message: OutboundMessage): Promise<boolean>;
}

export const MESSAGE_SENDER = Symbol('MESSAGE_SENDER');

export class DevOutboxSender implements MessageSender {
  readonly name = 'dev-outbox';
  private readonly messages: (OutboundMessage & { sentAt: string })[] = [];

  send(message: OutboundMessage): Promise<boolean> {
    this.messages.unshift({ ...message, sentAt: new Date().toISOString() });
    this.messages.length = Math.min(this.messages.length, 100);
    return Promise.resolve(true);
  }

  /** Newest first. */
  messagesFor(to: string) {
    return this.messages.filter((m) => m.to === to);
  }
}

export class UnconfiguredSender implements MessageSender {
  readonly name = 'none';

  constructor(private readonly logger: AppLogger) {}

  send(message: OutboundMessage): Promise<boolean> {
    // Never log the recipient or the body: the body contains a code or link.
    this.logger.emit('warn', 'Message delivery is not configured; message dropped', { context: 'Messaging', kind: message.kind });
    return Promise.resolve(false);
  }
}
