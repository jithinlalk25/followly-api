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
  SEND_EMAIL_QUEUE,
  JOB_SEND_CAMPAIGN_EMAILS,
  JOB_SEND_FOLLOW_UP_EMAIL,
  SendCampaignEmailsJobPayload,
  SendFollowUpEmailJobPayload,
} from './constants/send-email-queue';
import { EmailService, plainTextToHtml } from '../email/email.service';

/**
 * Processes "send campaign emails" jobs. Runs only in the email worker process.
 * For now mocks sending; real email delivery to be implemented later.
 */
@Processor(SEND_EMAIL_QUEUE, { concurrency: 5 })
@Injectable()
export class SendEmailProcessor extends WorkerHost {
  private readonly logger = new Logger(SendEmailProcessor.name);

  constructor(
    @InjectModel(Campaign.name) private readonly campaignModel: Model<Campaign>,
    @InjectModel(CampaignLeads.name)
    private readonly campaignLeadsModel: Model<CampaignLeads>,
    private readonly emailService: EmailService,
  ) {
    super();
  }

  async process(
    job: Job<
      SendCampaignEmailsJobPayload | SendFollowUpEmailJobPayload,
      unknown,
      string
    >,
  ): Promise<void> {
    this.logger.log(`Processing job ${job.id} name=${job.name}`);
    switch (job.name) {
      case JOB_SEND_CAMPAIGN_EMAILS:
        return this.handleSendCampaignEmails(
          job as Job<SendCampaignEmailsJobPayload>,
        );
      case JOB_SEND_FOLLOW_UP_EMAIL:
        return this.handleSendFollowUpEmail(
          job as Job<SendFollowUpEmailJobPayload>,
        );
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
        throw new Error(`Unknown job name: ${job.name}`);
    }
  }

  private async handleSendCampaignEmails(
    job: Job<SendCampaignEmailsJobPayload>,
  ): Promise<void> {
    const { campaignId, leadId } = job.data;
    const campaignIdObj = new Types.ObjectId(campaignId);
    const leadIdObj = new Types.ObjectId(leadId);
    this.logger.log(`Sending initial email campaign=${campaignId} lead=${leadId}`);

    const campaign = await this.campaignModel
      .findById(campaignIdObj)
      .lean()
      .exec();
    const campaignLead = await this.campaignLeadsModel
      .findOne({ campaignId: campaignIdObj, leadId: leadIdObj })
      .populate('leadId', 'email name')
      .lean()
      .exec();

    if (!campaignLead) {
      this.logger.warn(`Campaign lead not found campaignId=${campaignId} leadId=${leadId}, skipping`);
      return;
    }

    const lead = campaignLead.leadId as unknown as {
      email: string;
      name: string;
    } | null;
    const subject =
      campaignLead.subjectDraft?.trim() ||
      (campaign?.name ? `Re: ${campaign.name}` : 'Re: Follow-up');

    if (lead?.email) {
      this.logger.log(`Sending initial email to ${lead.email} campaign=${campaignId} lead=${leadId}`);
      await this.emailService.sendEmail({
        to: lead.email,
        subject,
        html: plainTextToHtml(campaignLead.emailDraft ?? ''),
        senderName: campaign?.settings?.senderName,
        leadId: leadIdObj,
        campaignId: campaignIdObj,
        campaignLeadId: campaignLead._id,
      });
      await new Promise((resolve) => setTimeout(resolve, 1500)); // Throttle
    } else {
      this.logger.warn(`Lead has no email campaignId=${campaignId} leadId=${leadId}, marking sent without sending`);
    }

    const followUpEnabled = campaign?.settings?.isFollowUpEnabled ?? false;
    const nextStatus = followUpEnabled
      ? CampaignLeadStatus.INITIAL_EMAILS_SEND_COMPLETED
      : CampaignLeadStatus.COMPLETED;

    await this.campaignLeadsModel
      .updateOne(
        { _id: campaignLead._id },
        { $set: { status: nextStatus } },
      )
      .exec();

    this.logger.log(`Initial email completed for campaign=${campaignId} lead=${leadId}`);
    if (followUpEnabled) {
      await this.tryMarkCampaignInitialEmailsCompletedIfAllDone(campaignIdObj);
    } else {
      await this.tryMarkCampaignCompletedIfAllLeadsDone(campaignIdObj);
    }
  }

  /**
   * If every campaign lead has initial email sent (or completed), mark campaign as INITIAL_EMAILS_SEND_COMPLETED.
   */
  private async tryMarkCampaignInitialEmailsCompletedIfAllDone(
    campaignId: Types.ObjectId,
  ): Promise<void> {
    const hasPendingLead = await this.campaignLeadsModel
      .exists({
        campaignId,
        status: {
          $nin: [
            CampaignLeadStatus.INITIAL_EMAILS_SEND_COMPLETED,
            CampaignLeadStatus.COMPLETED,
          ],
        },
      })
      .exec();

    if (!hasPendingLead) {
      this.logger.log(`All initial emails sent for campaign=${campaignId}, marking INITIAL_EMAILS_SEND_COMPLETED`);
      await this.campaignModel
        .updateOne(
          { _id: campaignId },
          { $set: { status: CampaignStatus.INITIAL_EMAILS_SEND_COMPLETED } },
        )
        .exec();
    }
  }

  private async handleSendFollowUpEmail(
    job: Job<SendFollowUpEmailJobPayload>,
  ): Promise<void> {
    const { campaignId, leadId } = job.data;
    const campaignIdObj = new Types.ObjectId(campaignId);
    const leadIdObj = new Types.ObjectId(leadId);
    this.logger.log(`Processing follow-up email campaign=${campaignId} lead=${leadId}`);

    const campaignLead = await this.campaignLeadsModel
      .findOne({ campaignId: campaignIdObj, leadId: leadIdObj })
      .populate('leadId', 'email name')
      .lean()
      .exec();

    if (!campaignLead) {
      this.logger.warn(`Campaign lead not found campaignId=${campaignId} leadId=${leadId}, skipping follow-up`);
      return;
    }
    if (campaignLead.isReplyReceived || campaignLead.isFollowUpEmailSent) {
      this.logger.log(`Skipping follow-up: reply received or already sent campaignId=${campaignId} leadId=${leadId}`);
      return;
    }

    const lead = campaignLead.leadId as unknown as {
      email: string;
      name: string;
    } | null;
    if (!lead?.email) {
      this.logger.warn(`Lead has no email, skipping follow-up campaignId=${campaignId} leadId=${leadId}`);
      return;
    }

    const campaign = await this.campaignModel
      .findById(campaignIdObj)
      .lean()
      .exec();
    const subject =
      campaignLead.followupSubjectDraft?.trim() ||
      (campaignLead.subjectDraft?.trim()
        ? `Re: ${campaignLead.subjectDraft.trim()} (follow-up)`
        : campaign?.name
          ? `Re: ${campaign.name} (follow-up)`
          : 'Re: Follow-up');
    const html =
      campaignLead.followupEmailDraft?.trim()
        ? plainTextToHtml(campaignLead.followupEmailDraft.trim())
        : (() => {
            const initialDraft = campaignLead.emailDraft ?? '';
            const firstLine =
              initialDraft.split(/\n/)[0]?.trim().slice(0, 120) ??
              'my previous message';
            const ellipsis = firstLine.length >= 120 ? '…' : '';
            return `<p>Following up on my previous message – ${firstLine}${ellipsis}</p><p>Would you have a few minutes to connect?</p>`;
          })();

    this.logger.log(`Sending follow-up email to ${lead.email} campaign=${campaignId} lead=${leadId}`);
    await this.emailService.sendFollowUpEmail({
      to: lead.email,
      subject,
      html,
      senderName: campaign?.settings?.senderName,
      leadId: leadIdObj,
      campaignId: campaignIdObj,
      campaignLeadId: campaignLead._id,
    });

    await this.campaignLeadsModel
      .updateOne(
        { _id: campaignLead._id },
        {
          $set: {
            isFollowUpEmailSent: true,
            followUpEmailSentAt: new Date(),
            status: CampaignLeadStatus.COMPLETED,
          },
        },
      )
      .exec();

    this.logger.log(`Follow-up email sent campaign=${campaignId} lead=${leadId}`);
    await this.tryMarkCampaignCompletedIfAllLeadsDone(campaignIdObj);
  }

  /**
   * If no lead has status other than COMPLETED, mark the campaign as COMPLETED.
   */
  private async tryMarkCampaignCompletedIfAllLeadsDone(
    campaignId: Types.ObjectId,
  ): Promise<void> {
    const hasIncompleteLead = await this.campaignLeadsModel
      .exists({
        campaignId,
        status: { $ne: CampaignLeadStatus.COMPLETED },
      })
      .exec();

    if (!hasIncompleteLead) {
      this.logger.log(`All leads done for campaign=${campaignId}, marking campaign COMPLETED`);
      await this.campaignModel
        .updateOne(
          { _id: campaignId },
          { $set: { status: CampaignStatus.COMPLETED } },
        )
        .exec();
    }
  }
}
