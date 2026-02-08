import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MongooseModule } from '@nestjs/mongoose';
import { EMAIL_DRAFTS_QUEUE } from '../campaign/constants/email-drafts-queue';
import { DEFAULT_JOB_OPTIONS } from '../campaign/constants/queue-defaults';
import { Campaign, CampaignSchema } from '../campaign/schema/campaign.schema';
import {
  CampaignLeads,
  CampaignLeadsSchema,
} from '../campaign/schema/campaign-leads.schema';
import { Lead, LeadSchema } from '../lead/schema/lead.schema';
import { EmailDraftsProcessor } from '../campaign/email-drafts.processor';

/**
 * Worker module: runs as a separate process (see worker-main.ts).
 * Connects to the same Redis and MongoDB as the API.
 * Only registers queue consumers (processors); no HTTP server.
 */
@Module({
  imports: [
    MongooseModule.forRoot(process.env.MONGODB_URI!, { autoIndex: true }),
    BullModule.forRoot({
      connection: { url: process.env.REDIS_URL! },
    }),
    BullModule.registerQueue({
      name: EMAIL_DRAFTS_QUEUE,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    }),
    MongooseModule.forFeature([
      { name: Campaign.name, schema: CampaignSchema },
      { name: CampaignLeads.name, schema: CampaignLeadsSchema },
      { name: Lead.name, schema: LeadSchema },
    ]),
  ],
  providers: [EmailDraftsProcessor],
})
export class WorkerModule {}
