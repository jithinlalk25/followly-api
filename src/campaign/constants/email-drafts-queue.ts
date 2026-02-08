/**
 * Queue name shared between API (producer) and worker (consumer).
 * API adds jobs; worker process runs the processor.
 */
export const EMAIL_DRAFTS_QUEUE = 'email-drafts';

export const JOB_GENERATE_DRAFTS = 'generate-drafts';

export interface GenerateEmailDraftsJobPayload {
  campaignId: string;
  leadId: string;
}
