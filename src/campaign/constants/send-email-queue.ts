/**
 * Queue name shared between API (producer) and email worker (consumer).
 * API adds jobs when campaign is launched; email worker sends emails.
 */
export const SEND_EMAIL_QUEUE = 'send-email';

export const JOB_SEND_CAMPAIGN_EMAILS = 'send-campaign-emails';

export interface SendCampaignEmailsJobPayload {
  campaignId: string;
  leadId: string;
}

export const JOB_SEND_FOLLOW_UP_EMAIL = 'send-follow-up-email';

export interface SendFollowUpEmailJobPayload {
  campaignId: string;
  leadId: string;
}
