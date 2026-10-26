import { DynamicModule, Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuditController } from './audit/audit.controller';
import { AuditService } from './audit/audit.service';
import { BuildingsController } from './buildings/buildings.controller';
import { AUTH_RATE_LIMITED, AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { PasswordResetService } from './auth/password-reset.service';
import { SessionService } from './auth/session.service';
import { PermissionGuard } from './authz/permission.guard';
import { SocietyAccessService } from './authz/society-access.service';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { LOGGER, type AppLogger } from './common/logger';
import { APP_CONFIG, type AppConfig } from './config';
import { HealthController } from './health/health.controller';
import { InvitationsController } from './invitations/invitations.controller';
import { InvitationsService } from './invitations/invitations.service';
import { MembersController } from './members/members.controller';
import { MembershipLifecycleService } from './members/membership-lifecycle.service';
import { MembershipsController } from './memberships/memberships.controller';
import { DevOutboxController } from './messaging/dev-outbox.controller';
import { DevOutboxSender, MESSAGE_SENDER, UnconfiguredSender } from './messaging/message-sender';
import { PrismaModule } from './prisma/prisma.service';
import { ProfileController } from './profile/profile.controller';
import { ResidentImportService } from './residents/resident-import.service';
import { ResidentsController } from './residents/residents.controller';
import { ResidentsService } from './residents/residents.service';
import { SocietiesController } from './societies/societies.controller';
import { UnitsController } from './units/units.controller';

/** Makes the validated config and the structured logger injectable everywhere. */
@Global()
@Module({})
class CoreModule {
  static register(config: AppConfig, logger: AppLogger): DynamicModule {
    return {
      module: CoreModule,
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: LOGGER, useValue: logger },
      ],
      exports: [APP_CONFIG, LOGGER],
    };
  }
}

@Module({})
export class AppModule {
  static register(config: AppConfig, logger: AppLogger): DynamicModule {
    return {
      module: AppModule,
      imports: [
        CoreModule.register(config, logger),
        PrismaModule,
        ThrottlerModule.forRoot({
          throttlers: [
            { name: 'default', ttl: 60_000, limit: 600 },
            {
              name: 'auth',
              ttl: config.authRateTtlMs,
              limit: config.authRateLimit,
              skipIf: (ctx) => !Reflect.getMetadata(AUTH_RATE_LIMITED, ctx.getHandler()),
            },
          ],
        }),
      ],
      controllers: [
        HealthController,
        AuthController,
        ProfileController,
        SocietiesController,
        MembershipsController,
        MembersController,
        BuildingsController,
        UnitsController,
        ResidentsController,
        InvitationsController,
        AuditController,
        // Development-safe message delivery; config refuses dev-outbox in production.
        ...(config.messageDelivery === 'dev-outbox' ? [DevOutboxController] : []),
      ],
      providers: [
        {
          provide: MESSAGE_SENDER,
          useValue: config.messageDelivery === 'dev-outbox' ? new DevOutboxSender() : new UnconfiguredSender(logger),
        },
        SessionService,
        PasswordResetService,
        AuditService,
        SocietyAccessService,
        MembershipLifecycleService,
        ResidentsService,
        ResidentImportService,
        InvitationsService,
        // Guards run in this order: rate limit → authentication → permissions.
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: PermissionGuard },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    };
  }
}
