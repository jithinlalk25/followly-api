import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Campaign, CampaignStatus } from './schema/campaign.schema';
import {
  CampaignLeads,
  CampaignLeadStatus,
} from './schema/campaign-leads.schema';
import {
  EMAIL_DRAFTS_QUEUE,
  JOB_GENERATE_DRAFTS,
  GenerateEmailDraftsJobPayload,
} from './constants/email-drafts-queue';
import { Lead } from '../lead/schema/lead.schema';
import { UserService } from '../user/user.service';
import { generateText } from '../../utils/openai.service';

/**
 * Processes "generate email drafts" jobs from the email-drafts queue.
 * Runs only in the worker process (see worker-main.ts).
 */
@Processor(EMAIL_DRAFTS_QUEUE, { concurrency: 3 })
@Injectable()
export class EmailDraftsProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailDraftsProcessor.name);

  constructor(
    @InjectModel(Campaign.name) private readonly campaignModel: Model<Campaign>,
    @InjectModel(CampaignLeads.name)
    private readonly campaignLeadsModel: Model<CampaignLeads>,
    @InjectModel(Lead.name) private readonly leadModel: Model<Lead>,
    private readonly userService: UserService,
  ) {
    super();
  }

  async process(job: Job<GenerateEmailDraftsJobPayload, unknown, string>) {
    this.logger.log(`Processing job ${job.id} name=${job.name}`);
    switch (job.name) {
      case JOB_GENERATE_DRAFTS:
        return this.handleGenerateDrafts(job);
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
        throw new Error(`Unknown job name: ${job.name}`);
    }
  }

  private async handleGenerateDrafts(
    job: Job<GenerateEmailDraftsJobPayload>,
  ): Promise<void> {
    const { campaignId, leadId } = job.data;
    const campaignIdObj = new Types.ObjectId(campaignId);
    const leadIdObj = new Types.ObjectId(leadId);
    this.logger.log(
      `Generating draft for campaign=${campaignId} lead=${leadId}`,
    );

    const campaignLead = await this.campaignLeadsModel
      .findOne({ campaignId: campaignIdObj, leadId: leadIdObj })
      .lean()
      .exec();

    if (!campaignLead) {
      this.logger.warn(
        `Campaign lead not found campaignId=${campaignId} leadId=${leadId}, skipping`,
      );
      return;
    }

    const campaign = await this.campaignModel
      .findById(campaignIdObj)
      .lean()
      .exec();
    const lead = await this.leadModel.findById(leadIdObj).lean().exec();
    if (!campaign || !lead) {
      this.logger.warn(
        `Campaign or lead not found campaignId=${campaignId} leadId=${leadId}, skipping`,
      );
      return;
    }
    const followUpEnabled = campaign.settings?.isFollowUpEnabled ?? false;
    this.logger.log(
      `Building prompt for campaign=${campaignId} lead=${leadId} followUpEnabled=${followUpEnabled}`,
    );
    let prompt: string;
    try {
      prompt = this.buildDraftPrompt(campaign, lead, followUpEnabled);
    } catch (err) {
      this.logger.error(
        `Error building prompt for campaign=${campaignId} lead=${leadId}: ${err}`,
      );
      throw err;
    }

    this.logger.log(
      `Prompt built (length=${prompt.length}), calling LLM campaignId=${campaignId} leadId=${leadId}`,
    );
    let raw: string;
    try {
      console.log('prompt', prompt);
      raw = await generateText(prompt);
      console.log('raw', raw);
      await job.updateProgress(100);
    } catch (err) {
      this.logger.error(
        `OpenAI draft generation failed for campaign=${campaignId} lead=${leadId}: ${err}`,
      );
      throw err;
    }

    const parsed = this.parseDraftJson(raw, followUpEnabled);
    if (!parsed) {
      this.logger.error(
        `Invalid draft JSON for campaign=${campaignId} lead=${leadId}`,
      );
      throw new Error('LLM returned invalid JSON for draft');
    }
    const subjectDraft =
      campaign.settings?.subjectFromUser && campaign.settings?.subject?.trim()
        ? campaign.settings.subject.trim()
        : parsed.subject.trim();
    const emailDraft = parsed.body.trim();

    const updatePayload: Record<string, unknown> = {
      status: CampaignLeadStatus.EMAIL_DRAFT_GENERATION_COMPLETED,
      subjectDraft,
      emailDraft,
    };
    if (followUpEnabled && parsed.followupSubject != null && parsed.followupBody != null) {
      updatePayload.followupSubjectDraft = parsed.followupSubject.trim();
      updatePayload.followupEmailDraft = parsed.followupBody.trim();
    }

    await this.campaignLeadsModel
      .updateOne(
        { _id: campaignLead._id },
        { $set: updatePayload },
      )
      .exec();

    const draftCount =
      followUpEnabled && parsed.followupSubject != null && parsed.followupBody != null
        ? 2
        : 1;
    await this.userService.updateSummary(campaign.userId, {
      emailDraftsCount: draftCount,
    });

    this.logger.log(
      `Draft generated for campaign=${campaignId} lead=${leadId}`,
    );
    await this.tryMarkCampaignDraftGenerationCompletedIfAllDone(campaignIdObj);
  }

  /**
   * Parses LLM response as JSON with subject and body; optionally followupSubject and followupBody.
   * Strips optional markdown code fence.
   */
  private parseDraftJson(
    raw: string,
    expectFollowUp?: boolean,
  ): {
    subject: string;
    body: string;
    followupSubject?: string;
    followupBody?: string;
  } | null {
    const trimmed = raw.trim();
    const withoutFence = trimmed
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    try {
      const obj = JSON.parse(withoutFence) as unknown;
      if (obj && typeof obj === 'object' && 'subject' in obj && 'body' in obj) {
        const subject = String(
          (obj as { subject: unknown }).subject ?? '',
        ).trim();
        const body = String((obj as { body: unknown }).body ?? '').trim();
        const result: {
          subject: string;
          body: string;
          followupSubject?: string;
          followupBody?: string;
        } = { subject, body };
        if (expectFollowUp && 'followupSubject' in obj && 'followupBody' in obj) {
          result.followupSubject = String(
            (obj as { followupSubject: unknown }).followupSubject ?? '',
          ).trim();
          result.followupBody = String(
            (obj as { followupBody: unknown }).followupBody ?? '',
          ).trim();
        }
        return result;
      }
    } catch {
      // fall through
    }
    return null;
  }

  /**
   * Builds the prompt for the LLM to generate subject and body as valid JSON.
   */
  private buildDraftPrompt(
    campaign: {
      name: string;
      settings?: {
        tone?: string;
        description?: string; // product / value proposition
        signature?: string; // sender signature
        emailLength?: string;
      };
    },
    lead: {
      name: string;
      email: string;
      additionalInfo: Record<string, string>;
    },
    followUpEnabled: boolean,
  ): string {
    const tone = campaign?.settings?.tone ?? 'PROFESSIONAL';
    const description = campaign?.settings?.description?.trim();
    const emailLength = campaign?.settings?.emailLength ?? 'SHORT';
    const campaignName = String(campaign?.name ?? '').trim() || 'Campaign';
    const leadName = String(lead?.name ?? '').trim() || 'Recipient';
    const leadEmail = String(lead?.email ?? '').trim();
    const signature = campaign?.settings?.signature?.trim();

    const additionalInfo =
      lead?.additionalInfo && typeof lead.additionalInfo === 'object'
        ? lead.additionalInfo
        : {};

    const additionalContext =
      Object.keys(additionalInfo).length > 0
        ? `Additional recipient context (use only if relevant): ${JSON.stringify(additionalInfo)}`
        : '';

    const productContext = description
      ? `Product / Context you MAY reference (do not invent beyond this): ${description}`
      : '';

    const signatureRule = signature
      ? `Use this exact signature at the end of the email:\n${signature}`
      : `Do NOT add a signature.`;

    const jsonShape = followUpEnabled
      ? `{"subject": "<short subject line, under 10 words>", "body": "<email body as plain text or simple HTML>", "followupSubject": "<short follow-up subject, under 10 words>", "followupBody": "<follow-up email body as plain text or simple HTML>"}`
      : `{"subject": "<short subject line, under 10 words>", "body": "<email body as plain text or simple HTML>"}`;

    const followUpInstructions = followUpEnabled
      ? `
  Also provide a follow-up email (followupSubject and followupBody). The follow-up will be sent only if the recipient has NOT replied. It should:
  - Be a gentle, friendly reminder (same tone and length as above).
  - Reference the initial outreach without repeating it verbatim.
  - Include a clear, low-friction ask (e.g. "Would you have a few minutes to connect?").
  - ${signatureRule}
  - Be concise and respectful.`
      : '';

    return `
  You are writing a personalized sales outreach email.
  
  Campaign: "${campaignName}"
  Goal: outreach
  Tone: ${tone}
  Length: ${emailLength}
  
  Recipient: ${leadName} (${leadEmail})
  ${additionalContext}
  ${productContext}
  
  CRITICAL RULES (MUST FOLLOW):
  - Do NOT invent a sender name, company name, product, role, or background.
  - Do NOT invent features, benefits, metrics, or claims.
  - Use ONLY the information explicitly provided above.
  - If product or company context is missing, write a neutral, permission-based outreach.
  - Do NOT assume the recipient’s needs, tools, or priorities.
  - ${signatureRule}
  ${followUpInstructions}
  
  Respond with valid JSON only, no other text.
  Use exactly this shape:
  ${jsonShape}
  
  Keep the email concise, professional, and respectful.
  `.trim();
  }

  /**
   * If every campaign lead has draft generated, mark campaign as EMAIL_DRAFT_GENERATION_COMPLETED.
   */
  private async tryMarkCampaignDraftGenerationCompletedIfAllDone(
    campaignId: Types.ObjectId,
  ): Promise<void> {
    const hasPendingLead = await this.campaignLeadsModel
      .exists({
        campaignId,
        status: { $ne: CampaignLeadStatus.EMAIL_DRAFT_GENERATION_COMPLETED },
      })
      .exec();

    if (!hasPendingLead) {
      this.logger.log(
        `All drafts done for campaign=${campaignId}, marking campaign EMAIL_DRAFT_GENERATION_COMPLETED`,
      );
      await this.campaignModel
        .updateOne(
          { _id: campaignId },
          {
            $set: {
              status: CampaignStatus.EMAIL_DRAFT_GENERATION_COMPLETED,
            },
          },
        )
        .exec();
    }
  }
}
