import { DynamicModule, Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AUTH_RATE_LIMITED, AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { OTP_PROVIDER, UnconfiguredOtpProvider } from './auth/otp/otp-provider';
import { SessionService } from './auth/session.service';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { LOGGER, type AppLogger } from './common/logger';
import { APP_CONFIG, type AppConfig } from './config';
import { HealthController } from './health/health.controller';
import { MembershipAccessService } from './memberships/membership-access.service';
import { MembershipsController } from './memberships/memberships.controller';
import { PrismaModule } from './prisma/prisma.service';
import { ProfileController } from './profile/profile.controller';
import { SocietiesController } from './societies/societies.controller';

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
      controllers: [HealthController, AuthController, ProfileController, SocietiesController, MembershipsController],
      providers: [
        { provide: OTP_PROVIDER, useClass: UnconfiguredOtpProvider },
        SessionService,
        MembershipAccessService,
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    };
  }
}
