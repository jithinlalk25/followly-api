import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UserModule } from './user/user.module';
import { AuthModule } from './auth/auth.module';
import { MongooseModule } from '@nestjs/mongoose';
import { LeadModule } from './lead/lead.module';
import { CompanyModule } from './company/company.module';
import { CampaignModule } from './campaign/campaign.module';
import { EMAIL_DRAFTS_QUEUE } from './campaign/constants/email-drafts-queue';
import { SEND_EMAIL_QUEUE } from './campaign/constants/send-email-queue';
import { DEFAULT_JOB_OPTIONS } from './campaign/constants/queue-defaults';
import { EmailModule } from './email/email.module';

@Module({
  imports: [
    MongooseModule.forRoot(process.env.MONGODB_URI!, {
      autoIndex: true,
    }),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
      },
    }),
    BullModule.registerQueue(
      { name: EMAIL_DRAFTS_QUEUE, defaultJobOptions: DEFAULT_JOB_OPTIONS },
      { name: SEND_EMAIL_QUEUE, defaultJobOptions: DEFAULT_JOB_OPTIONS },
    ),
    UserModule,
    AuthModule,
    LeadModule,
    CompanyModule,
    CampaignModule,
    EmailModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
