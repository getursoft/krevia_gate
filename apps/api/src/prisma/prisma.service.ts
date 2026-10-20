import { Global, Inject, Injectable, Module, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { PrismaClient, type Prisma } from '@prisma/client';
import { LOGGER, type AppLogger } from '../common/logger';

@Injectable()
export class PrismaService
  extends PrismaClient<Prisma.PrismaClientOptions, 'warn' | 'error'>
  implements OnModuleInit, OnModuleDestroy
{
  constructor(@Optional() @Inject(LOGGER) private readonly logger?: AppLogger) {
    // Warnings and errors only, emitted as events into the structured logger.
    // Queries are never logged (they may carry personal data).
    super({ log: [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }] });
    this.$on('warn', (e) => logger?.emit('warn', e.message, { context: 'Prisma', target: e.target }));
    this.$on('error', (e) => logger?.emit('error', e.message, { context: 'Prisma', target: e.target }));
  }

  async onModuleInit() {
    try {
      await this.$connect();
    } catch (err) {
      // Keep the process alive: liveness stays 200, readiness reports 503 until the
      // database is reachable (Prisma reconnects on the next query).
      this.logger?.emit('warn', 'Database unavailable at startup; /api/v1/ready will report not_ready until it recovers', {
        context: 'Prisma',
        error: err,
      });
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
