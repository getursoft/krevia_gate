import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { BRAND, CLIENT_HEADER } from '@krevia/shared';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppLogger } from './common/logger';
import { originCheck } from './common/origin-check.middleware';
import { requestContext } from './common/request-context.middleware';
import { type AppConfig } from './config';

export const API_GLOBAL_PREFIX = 'api/v1';

export const SERVICE_NAME = 'krevia-api';

export function createLogger(config: AppConfig): AppLogger {
  return new AppLogger({ service: SERVICE_NAME, env: config.env, level: config.logLevel, format: config.logFormat });
}

/**
 * Builds a fully configured app. Used by main.ts and by the integration tests
 * (which may pass their own logger to capture output).
 */
export async function createApp(config: AppConfig, logger: AppLogger = createLogger(config)): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(config, logger), {
    logger,
    bodyParser: false,
  });
  if (config.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.useBodyParser('json', { limit: '32kb' });
  app.use(requestContext(logger));
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', CLIENT_HEADER, 'X-Request-Id'],
  });
  app.use(originCheck(config.corsOrigins));
  app.setGlobalPrefix(API_GLOBAL_PREFIX);
  app.enableShutdownHooks();

  if (!config.isProduction) {
    const doc = new DocumentBuilder()
      .setTitle(`${BRAND.name} API`)
      .setDescription(`${BRAND.tagline} — Sprint 1 resident onboarding API`)
      .setVersion('1.0.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', description: 'Mobile session token' })
      .addCookieAuth('krevia_session')
      .build();
    SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, doc));
  }
  return app;
}
