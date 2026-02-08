import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MongooseModule } from '@nestjs/mongoose';
import { SEND_EMAIL_QUEUE } from '../campaign/constants/send-email-queue';
import { DEFAULT_JOB_OPTIONS } from '../campaign/constants/queue-defaults';
import { Campaign, CampaignSchema } from '../campaign/schema/campaign.schema';
import {
  CampaignLeads,
  CampaignLeadsSchema,
} from '../campaign/schema/campaign-leads.schema';
import { Lead, LeadSchema } from '../lead/schema/lead.schema';
import { SendEmailProcessor } from '../campaign/send-email.processor';
import { EmailModule } from '../email/email.module';

/**
 * Email worker module: runs as a separate process (see worker-email-main.ts).
 * Connects to the same Redis and MongoDB as the API.
 * Only consumes send-email queue jobs; no HTTP server.
 */
@Module({
  imports: [
    MongooseModule.forRoot(process.env.MONGODB_URI!, { autoIndex: true }),
    BullModule.forRoot({
      connection: { url: process.env.REDIS_URL! },
    }),
    BullModule.registerQueue({
      name: SEND_EMAIL_QUEUE,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    }),
    MongooseModule.forFeature([
      { name: Campaign.name, schema: CampaignSchema },
      { name: CampaignLeads.name, schema: CampaignLeadsSchema },
      { name: Lead.name, schema: LeadSchema },
    ]),
    EmailModule,
  ],
  providers: [SendEmailProcessor],
})
export class WorkerEmailModule {}
