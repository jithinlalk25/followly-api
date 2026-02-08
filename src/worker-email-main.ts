import { NestFactory } from '@nestjs/core';
import { WorkerEmailModule } from './worker/worker-email.module';

process.env.TZ = 'UTC';

/**
 * Email worker entry point: runs the send-email BullMQ consumer only (no HTTP server).
 * Start with: npm run start:worker:email
 * Requires REDIS_HOST/REDIS_PORT and MONGODB_URI (same as API).
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerEmailModule, {
    logger: ['log', 'error', 'warn'],
  });
  await app.init();
  // Context stays alive; worker processes send-email jobs from Redis
}

bootstrap().catch((err) => {
  console.error('Email worker failed to start', err);
  process.exit(1);
});
