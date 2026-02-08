import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MongooseModule } from '@nestjs/mongoose';
import { CampaignController } from './campaign.controller';
import { CampaignService } from './campaign.service';
import { Campaign, CampaignSchema } from './schema/campaign.schema';
import {
  CampaignLeads,
  CampaignLeadsSchema,
} from './schema/campaign-leads.schema';
import { AuthModule } from '../auth/auth.module';
import { LeadModule } from '../lead/lead.module';
import { UserModule } from '../user/user.module';
import { EMAIL_DRAFTS_QUEUE } from './constants/email-drafts-queue';
import { SEND_EMAIL_QUEUE } from './constants/send-email-queue';
import { DEFAULT_JOB_OPTIONS } from './constants/queue-defaults';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Campaign.name, schema: CampaignSchema },
      { name: CampaignLeads.name, schema: CampaignLeadsSchema },
    ]),
    BullModule.registerQueue(
      { name: EMAIL_DRAFTS_QUEUE, defaultJobOptions: DEFAULT_JOB_OPTIONS },
      { name: SEND_EMAIL_QUEUE, defaultJobOptions: DEFAULT_JOB_OPTIONS },
    ),
    AuthModule,
    LeadModule,
    UserModule,
  ],
  controllers: [CampaignController],
  providers: [CampaignService],
  exports: [CampaignService],
})
export class CampaignModule {}
