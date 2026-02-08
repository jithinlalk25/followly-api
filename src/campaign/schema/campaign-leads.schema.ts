import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { CampaignSettings, CampaignSettingsSchema } from './campaign.schema';

export enum CampaignLeadStatus {
  NOT_STARTED = 'NOT_STARTED',
  EMAIL_DRAFT_GENERATION_STARTED = 'EMAIL_DRAFT_GENERATION_STARTED',
  EMAIL_DRAFT_GENERATION_COMPLETED = 'EMAIL_DRAFT_GENERATION_COMPLETED',
  INITIAL_EMAILS_SEND_STARTED = 'INITIAL_EMAILS_SEND_STARTED',
  INITIAL_EMAILS_SEND_COMPLETED = 'INITIAL_EMAILS_SEND_COMPLETED',
  STOPPED = 'STOPPED',
  COMPLETED = 'COMPLETED',
}

@Schema({ collection: 'CampaignLeads', versionKey: false, timestamps: true })
export class CampaignLeads extends Document {
  declare _id: Types.ObjectId;

  @Prop({ required: true, ref: 'Campaign' })
  campaignId: Types.ObjectId;

  @Prop({ required: true, ref: 'Lead' })
  leadId: Types.ObjectId;

  @Prop({
    type: String,
    enum: CampaignLeadStatus,
    default: CampaignLeadStatus.NOT_STARTED,
  })
  status: CampaignLeadStatus;

  @Prop({ type: CampaignSettingsSchema })
  settings?: CampaignSettings;

  @Prop({ type: String })
  emailDraft: string;

  @Prop({ type: String })
  subjectDraft: string;

  @Prop({ type: String })
  followupEmailDraft: string;

  @Prop({ type: String })
  followupSubjectDraft: string;

  @Prop({ default: false })
  isFollowUpEmailSent: boolean;

  @Prop({ type: Date })
  followUpEmailSentAt: Date;

  @Prop({ default: false })
  isReplyReceived: boolean;

  @Prop({ type: Date })
  replyReceivedAt: Date;
}

export const CampaignLeadsSchema = SchemaFactory.createForClass(CampaignLeads);

// Lookup by campaign + lead (processors, campaign.service).
CampaignLeadsSchema.index({ campaignId: 1, leadId: 1 }, { unique: true });
// Exists/checks by campaign and status (send-email.processor, email-drafts.processor).
CampaignLeadsSchema.index({ campaignId: 1, status: 1 });
