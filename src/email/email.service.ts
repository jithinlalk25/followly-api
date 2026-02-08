import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { sendMail } from 'utils/resend.service';
import { Email, EmailDirection } from './schema/email.schema';
import { LeadService } from '../lead/lead.service';
import { CampaignService } from '../campaign/campaign.service';

const FROM_EMAIL = 'outreach@mail.followly.pro';
const DEFAULT_FROM = `Followly <${FROM_EMAIL}>`;

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
}

export interface SendFollowUpEmailOptions {
  to: string;
  subject: string;
  html: string;
  /** Sender name displayed to the recipient (e.g. "Jane Smith"). */
  senderName?: string;
  leadId: Types.ObjectId;
  campaignId: Types.ObjectId;
}

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
  ) {}

  /**
   * Sends an email and creates an entry in the email collection.
   */
  async sendEmail(options: SendEmailOptions): Promise<void> {
    const { to, subject, html, senderName, leadId, campaignId } = options;
    const from = buildFrom(senderName);
    // Signature is already included in the draft (see email-drafts.processor); do not append again.
    await sendMail({ from, to, subject, html });

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
  }

  /**
   * Sends a follow-up email and creates an entry in the email collection.
   * Does not schedule further follow-ups. Use for the delayed follow-up send only.
   */
  async sendFollowUpEmail(options: SendFollowUpEmailOptions): Promise<void> {
    const { to, subject, html, senderName, leadId, campaignId } = options;
    const from = buildFrom(senderName);
    // Signature is included in draft; follow-up body is built in send-email.processor without re-appending.
    await sendMail({ from, to, subject, html });

    await this.emailModel.create({
      leadId,
      campaignId,
      direction: EmailDirection.OUTBOUND,
      subject,
      body: html,
    });
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
   * Returns all emails for a lead. Only returns data if the lead exists and belongs to the given user.
   */
  async getEmailsByLead(
    leadId: Types.ObjectId,
    userId: Types.ObjectId,
  ): Promise<{ data: Email[] }> {
    const lead = await this.leadService.findOneByIdAndUserId(leadId, userId);
    if (!lead) {
      throw new NotFoundException('Lead not found');
    }
    const data = await this.emailModel
      .find({ leadId })
      .sort({ createdAt: -1 })
      .populate('campaignId')
      .lean()
      .exec();
    return { data };
  }
}
