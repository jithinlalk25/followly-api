import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { sendMail } from 'utils/resend.service';
import { Email, EmailDirection } from './schema/email.schema';
import { LeadService } from '../lead/lead.service';
import { CampaignService } from '../campaign/campaign.service';
import { CampaignLeads } from '../campaign/schema/campaign-leads.schema';
import { UserService } from '../user/user.service';
import { CompanyService } from '../company/company.service';

const FROM_EMAIL = 'outreach@mail.followly.pro';
const DEFAULT_FROM = `Followly <${FROM_EMAIL}>`;

/**
 * Builds Reply-To address that encodes the campaign-lead so inbound replies can be routed.
 * Uses RESEND_REPLY_TO_DOMAIN (e.g. reply.followly.pro) to form campaignlead-{campaignLeadId}@domain.
 * If RESEND_REPLY_TO_DOMAIN is not set, falls back to global RESEND_REPLY_TO when set.
 */
function getReplyTo(
  campaignLeadId: Types.ObjectId | undefined,
): string | undefined {
  return `cl-${String(campaignLeadId)}@mail.followly.pro`;
}

function buildFrom(senderName?: string): string {
  if (senderName?.trim()) {
    return `${senderName.trim()} <${FROM_EMAIL}>`;
  }
  return DEFAULT_FROM;
}

/**
 * Converts plain text (e.g. LLM draft with \n) to HTML so line breaks are preserved in email clients.
 * Escapes HTML entities to avoid breaking the message or introducing XSS.
 */
export function plainTextToHtml(text: string): string {
  if (!text) return '';
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return escaped.replace(/\n/g, '<br>\n');
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  /** Sender name displayed to the recipient (e.g. "Jane Smith"). */
  senderName?: string;
  /** Required to create an audit entry in the email collection. */
  leadId: Types.ObjectId;
  /** Required to create an audit entry in the email collection. */
  campaignId: Types.ObjectId;
  /** CampaignLeads document id; used to build per-campaign-lead Reply-To when RESEND_REPLY_TO_DOMAIN is set. */
  campaignLeadId?: Types.ObjectId;
}

export interface SendFollowUpEmailOptions {
  to: string;
  subject: string;
  html: string;
  /** Sender name displayed to the recipient (e.g. "Jane Smith"). */
  senderName?: string;
  leadId: Types.ObjectId;
  campaignId: Types.ObjectId;
  /** CampaignLeads document id; used to build per-campaign-lead Reply-To when RESEND_REPLY_TO_DOMAIN is set. */
  campaignLeadId?: Types.ObjectId;
}

/** Email document as returned by getEmailsByLead (lean + populated campaignId + campaignLead). */
export type EmailWithCampaignLead = {
  _id: Types.ObjectId;
  leadId: Types.ObjectId;
  campaignId: Types.ObjectId | { _id: Types.ObjectId };
  direction: EmailDirection;
  subject: string;
  body: string;
  createdAt?: Date;
  updatedAt?: Date;
  campaignLead: CampaignLeads | null;
};

/** Lead-shaped document returned when populating leadId on Email. */
export interface LeadPopulated {
  _id: Types.ObjectId;
  name: string;
  email: string;
  additionalInfo: Record<string, string>;
  userId: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

@Injectable()
export class EmailService {
  constructor(
    @InjectModel(Email.name) private readonly emailModel: Model<Email>,
    private readonly leadService: LeadService,
    private readonly campaignService: CampaignService,
    private readonly userService: UserService,
    private readonly companyService: CompanyService,
  ) {}

  /**
   * Returns true if the recipient is allowed to receive actual outbound email (testing allowlist).
   * If company has no allowlist, no one is allowed (safe default for testing).
   */
  private async shouldSendActualEmail(
    userId: Types.ObjectId,
    to: string,
  ): Promise<boolean> {
    const company = await this.companyService.getCompanyByUserId(userId);
    const list = company?.allowedEmailRecipients;
    if (!list || list.length === 0) return false;
    const normalized = to.trim().toLowerCase();
    return list.some((e) => e.trim().toLowerCase() === normalized);
  }

  /**
   * Sends an email and creates an entry in the email collection.
   * If company has an allowedEmailRecipients list (testing), only sends actual email when recipient is in the list; otherwise skips send silently.
   */
  async sendEmail(options: SendEmailOptions): Promise<void> {
    const {
      to,
      subject,
      html,
      senderName,
      leadId,
      campaignId,
      campaignLeadId,
    } = options;
    const campaign =
      await this.campaignService.getCampaignByIdInternal(campaignId);
    const shouldSend =
      campaign?.userId &&
      (await this.shouldSendActualEmail(campaign.userId, to));

    if (shouldSend) {
      const from = buildFrom(senderName);
      const replyTo = getReplyTo(campaignLeadId);
      // Signature is already included in the draft (see email-drafts.processor); do not append again.
      await sendMail({ from, to, subject, html, ...(replyTo && { replyTo }) });
    }

    await this.emailModel.create({
      leadId,
      campaignId,
      direction: EmailDirection.OUTBOUND,
      subject,
      body: html,
    });

    const campaignLead =
      await this.campaignService.getCampaignLeadByCampaignAndLead(
        campaignId,
        leadId,
      );

    const isFollowUpEnabled =
      campaignLead?.settings?.isFollowUpEnabled === true;
    if (isFollowUpEnabled && !campaignLead?.isFollowUpEmailSent) {
      await this.campaignService.scheduleFollowUpEmail(campaignId, leadId);
    }

    if (campaign?.userId) {
      await this.userService.updateSummary(campaign.userId, {
        emailSentCount: 1,
      });
    }
  }

  /**
   * Sends a follow-up email and creates an entry in the email collection.
   * Does not schedule further follow-ups. Use for the delayed follow-up send only.
   * If company has an allowedEmailRecipients list (testing), only sends actual email when recipient is in the list; otherwise skips send silently.
   */
  async sendFollowUpEmail(options: SendFollowUpEmailOptions): Promise<void> {
    const {
      to,
      subject,
      html,
      senderName,
      leadId,
      campaignId,
      campaignLeadId,
    } = options;
    const campaign =
      await this.campaignService.getCampaignByIdInternal(campaignId);
    const shouldSend =
      campaign?.userId &&
      (await this.shouldSendActualEmail(campaign.userId, to));

    if (shouldSend) {
      const from = buildFrom(senderName);
      const replyTo = getReplyTo(campaignLeadId);
      // Signature is included in draft; follow-up body is built in send-email.processor without re-appending.
      await sendMail({ from, to, subject, html, ...(replyTo && { replyTo }) });
    }

    await this.emailModel.create({
      leadId,
      campaignId,
      direction: EmailDirection.OUTBOUND,
      subject,
      body: html,
    });

    if (campaign?.userId) {
      await this.userService.updateSummary(campaign.userId, {
        emailSentCount: 1,
      });
    }
  }

  /**
   * Returns leads that have at least one email, paginated.
   * Fetches emails and populates leadId to get lead data; dedupes and filters by user.
   * Only returns leads belonging to the given user.
   */
  async getLeadsWithEmails(
    userId: Types.ObjectId,
    page: number = 1,
    limit: number = 10,
  ): Promise<{
    data: LeadPopulated[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const skip = Math.max(0, (page - 1) * limit);
    const safeLimit = Math.min(Math.max(1, limit), 100);

    const leadIdsWithEmails = await this.emailModel.distinct('leadId').exec();

    const emails = await this.emailModel
      .find({ leadId: { $in: leadIdsWithEmails } })
      .sort({ createdAt: -1 })
      .populate('leadId')
      .lean()
      .exec();

    const leadByLastEmail = new Map<
      string,
      { lead: LeadPopulated; lastEmailAt: number }
    >();
    for (const row of emails) {
      const lead = row.leadId as unknown as LeadPopulated | null;
      if (!lead || typeof lead !== 'object' || !lead._id) continue;
      if (String(lead.userId) !== String(userId)) continue;
      const key = String(lead._id);
      if (leadByLastEmail.has(key)) continue;
      const createdAt = (row as { createdAt?: Date }).createdAt;
      const emailAt = createdAt ? new Date(createdAt).getTime() : 0;
      leadByLastEmail.set(key, { lead, lastEmailAt: emailAt });
    }
    const leads: LeadPopulated[] = Array.from(leadByLastEmail.values())
      .sort((a, b) => b.lastEmailAt - a.lastEmailAt)
      .map(({ lead }) => lead);

    const total = leads.length;
    const data = leads.slice(skip, skip + safeLimit);

    return {
      data,
      total,
      page,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit) || 1,
    };
  }

  /**
   * Creates an inbound email entry (e.g. from a webhook when a lead replies).
   * Increments the user summary emailReceivedCount.
   */
  async createInboundEmail(options: {
    leadId: Types.ObjectId;
    campaignId: Types.ObjectId;
    subject: string;
    body: string;
  }): Promise<void> {
    await this.emailModel.create({
      leadId: options.leadId,
      campaignId: options.campaignId,
      direction: EmailDirection.INBOUND,
      subject: options.subject,
      body: options.body,
    });

    const campaign =
      await this.campaignService.getCampaignByIdInternal(options.campaignId);
    if (campaign?.userId) {
      await this.userService.updateSummary(campaign.userId, {
        emailReceivedCount: 1,
      });
    }
  }

  /**
   * Returns all emails for a lead. Only returns data if the lead exists and belongs to the given user.
   * Each item includes a `campaignLead` attribute with the CampaignLeads document for that email's campaign/lead.
   */
  async getEmailsByLead(
    leadId: Types.ObjectId,
    userId: Types.ObjectId,
  ): Promise<{ data: EmailWithCampaignLead[] }> {
    const lead = await this.leadService.findOneByIdAndUserId(leadId, userId);
    if (!lead) {
      throw new NotFoundException('Lead not found');
    }
    const [emails, campaignLeads] = await Promise.all([
      this.emailModel
        .find({ leadId })
        .sort({ createdAt: -1 })
        .populate('campaignId')
        .lean()
        .exec(),
      this.campaignService.getCampaignLeadsByLeadId(leadId),
    ]);
    const campaignLeadByCampaignId = new Map(
      campaignLeads.map((cl) => [cl.campaignId.toString(), cl]),
    );
    const data: EmailWithCampaignLead[] = emails.map((email) => {
      const campaignId =
        typeof email.campaignId === 'object' && email.campaignId !== null
          ? (email.campaignId as { _id: Types.ObjectId })._id
          : (email.campaignId as Types.ObjectId);
      const campaignLead = campaignId
        ? campaignLeadByCampaignId.get(campaignId.toString()) ?? null
        : null;
      return { ...email, campaignLead } as EmailWithCampaignLead;
    });
    return { data };
  }
}
