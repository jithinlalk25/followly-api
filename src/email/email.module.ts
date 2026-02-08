import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EmailController } from './email.controller';
import { EmailWebhookController } from './email-webhook.controller';
import { EmailService } from './email.service';
import { Email, EmailSchema } from './schema/email.schema';
import { LeadModule } from '../lead/lead.module';
import { CampaignModule } from '../campaign/campaign.module';
import { AuthModule } from '../auth/auth.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Email.name, schema: EmailSchema }]),
    LeadModule,
    CampaignModule,
    AuthModule,
    UserModule,
  ],
  controllers: [EmailController, EmailWebhookController],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
