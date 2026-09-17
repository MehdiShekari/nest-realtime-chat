import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { AppConfigService } from './config/app-config.service';
import { RedisIoAdapter } from './websocket/redis-io.adapter';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: false,
  });

  const config = app.get(AppConfigService);

  app.use(
    helmet({
      // Avatars are served from the same origin and consumed by the web app.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(cookieParser());

  app.enableCors({
    origin: config.webOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Serve avatars written by AvatarService.
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads/',
    // Uploads are content-addressed by UUID — safe to cache aggressively.
    maxAge: '7d',
    index: false,
  });

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.enableShutdownHooks();

  // ---- WebSocket layer -----------------------------------------------------
  const redisAdapter = new RedisIoAdapter(app, config);
  await redisAdapter.connectToRedis();
  app.useWebSocketAdapter(redisAdapter);

  // ---- Swagger -------------------------------------------------------------
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Realtime Chat API')
    .setDescription('REST + WebSocket API for the realtime chat and notification platform')
    .setVersion('1.0.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
    .addCookieAuth('refresh_token')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  await app.listen(config.apiPort);

  logger.log(`API listening on http://localhost:${config.apiPort}/api`);
  logger.log(`Swagger docs at http://localhost:${config.apiPort}/api/docs`);
}

void bootstrap();