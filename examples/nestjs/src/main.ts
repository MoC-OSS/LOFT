import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module';
import { env } from './config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Do not tell clients which framework serves them
  app.disable('x-powered-by');
  app.enableShutdownHooks();

  await app.listen(env.PORT);

  const logger = new Logger('Bootstrap');
  logger.log(`nestjs example running on http://localhost:${env.PORT}`);
  logger.log('POST /chat/sessions              — Create a session');
  logger.log('POST /chat                       — Send a message (body: { sessionId, message })');
  logger.log('GET  /chat/sessions/:id/history  — View conversation history');
  logger.log('GET  /chat/health                — Health check');
}

bootstrap().catch((error) => {
  console.error('Startup failed:', error);
  process.exit(1);
});
