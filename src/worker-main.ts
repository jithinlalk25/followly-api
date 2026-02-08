import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker/worker.module';

process.env.TZ = 'UTC';

/**
 * Worker entry point: runs the BullMQ consumer only (no HTTP server).
 * Start with: npm run start:worker
 * Requires REDIS_URL and MONGODB_URI (same as API).
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['log', 'error', 'warn'],
  });
  await app.init();
  // Context stays alive; workers process jobs from Redis
}

bootstrap().catch((err) => {
  console.error('Worker failed to start', err);
  process.exit(1);
});
