import { Controller, Get, Inject, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { HealthDto, ReadyDto } from '@krevia/shared';
import type { Response } from 'express';
import { Public } from '../auth/auth.guard';
import { LOGGER, type AppLogger } from '../common/logger';
import { PrismaService } from '../prisma/prisma.service';

const VERSION = process.env.npm_package_version ?? '0.1.0';
export const DB_CHECK_TIMEOUT_MS = 2000;

/**
 * Liveness (`/health`) answers "is the process up?" and never touches dependencies,
 * so a database outage does not get a healthy process restarted.
 * Readiness (`/ready`) answers "can it serve traffic?" and checks PostgreSQL,
 * the only critical dependency in Sprint 1. Neither response exposes hosts,
 * credentials or error details; the failure reason goes to the log only.
 */
@ApiTags('health')
@Public()
@SkipThrottle()
@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(LOGGER) private readonly logger: AppLogger,
  ) {}

  @Get('health')
  @ApiOperation({ summary: 'Liveness: the API process is running (no dependency checks)' })
  health(): HealthDto {
    return { status: 'ok', service: 'krevia-api', version: VERSION, time: new Date().toISOString() };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness: the database is reachable. 200 when ready, 503 otherwise' })
  async ready(@Res({ passthrough: true }) res: Response): Promise<ReadyDto> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`database check timed out after ${DB_CHECK_TIMEOUT_MS}ms`)), DB_CHECK_TIMEOUT_MS);
        }),
      ]);
      return { status: 'ready', service: 'krevia-api', checks: { database: 'up' } };
    } catch (err) {
      this.logger.emit('warn', 'Readiness check failed: database unavailable', { context: 'Health', error: err });
      res.status(503);
      return { status: 'not_ready', service: 'krevia-api', checks: { database: 'down' } };
    } finally {
      clearTimeout(timer);
    }
  }
}
