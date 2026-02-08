import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import type { NestExpressApplication } from '@nestjs/platform-express';

process.env.TZ = 'UTC';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true, // required for Resend webhook signature verification (Svix)
  });
  app.enableCors();
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
