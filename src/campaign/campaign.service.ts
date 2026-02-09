import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Queue } from 'bullmq';
import { Model, Types } from 'mongoose';
import {
  Campaign,
  CampaignStatus,
  FollowUpDelay,
  Tone,
} from './schema/campaign.schema';
import {
  CampaignLeads,
  CampaignLeadStatus,
} from './schema/campaign-leads.schema';
import { LeadService } from '../lead/lead.service';
import { UserService } from '../user/user.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignSettingsDto } from './dto/update-campaign-settings.dto';
import {
  EMAIL_DRAFTS_QUEUE,
  JOB_GENERATE_DRAFTS,
  GenerateEmailDraftsJobPayload,
} from './constants/email-drafts-queue';
import {
  SEND_EMAIL_QUEUE,
  JOB_SEND_CAMPAIGN_EMAILS,
  JOB_SEND_FOLLOW_UP_EMAIL,
  SendCampaignEmailsJobPayload,
  SendFollowUpEmailJobPayload,
} from './constants/send-email-queue';

@Injectable()
export class CampaignService {
  constructor(
    @InjectModel(Campaign.name) private readonly campaignModel: Model<Campaign>,
    @InjectModel(CampaignLeads.name)
    private readonly campaignLeadsModel: Model<CampaignLeads>,
    @InjectQueue(EMAIL_DRAFTS_QUEUE) private readonly emailDraftsQueue: Queue,
    @InjectQueue(SEND_EMAIL_QUEUE) private readonly sendEmailQueue: Queue,
    private readonly leadService: LeadService,
    private readonly userService: UserService,
  ) {}

  async create(
    userId: Types.ObjectId,
    dto: CreateCampaignDto,
  ): Promise<Campaign> {
    const rawIds = (dto.leadIds ?? []).filter(
      (id) => id != null && String(id).trim() !== '',
    );
    const leadIds: Types.ObjectId[] = [];
    for (const id of rawIds) {
      if (!Types.ObjectId.isValid(id)) {
        throw new BadRequestException(`Invalid lead id: ${id}`);
      }
      leadIds.push(new Types.ObjectId(id));
    }

    const uniqueIds = [...new Set(leadIds.map((id) => id.toString()))].map(
      (id) => new Types.ObjectId(id),
    );

    if (uniqueIds.length === 0) {
      throw new BadRequestException('At least one valid lead id is required');
    }

    const leadsOwnedByUser = await this.leadService.countLeadsOwnedByUser(
      userId,
      uniqueIds,
    );

    if (leadsOwnedByUser !== uniqueIds.length) {
      throw new BadRequestException(
        'All lead ids must exist and belong to the current user',
      );
    }

    const user = await this.userService.findById(userId);
    const defaultSignature = user?.name?.trim()
      ? `Best regards,\n${user.name.trim()}`
      : undefined;
    const campaign = await this.campaignModel.create({
      userId,
      name: dto.name,
      leadsCount: uniqueIds.length,
      settings: {
        tone: Tone.PROFESSIONAL,
        isFollowUpEnabled: false,
        senderName: user?.name ?? undefined,
        signature: defaultSignature,
        description: dto.description,
      },
      status: CampaignStatus.NOT_STARTED,
    });

    await this.campaignLeadsModel.insertMany(
      uniqueIds.map((leadId) => ({
        campaignId: campaign._id,
        leadId,
      })),
    );

    await this.userService.updateSummary(userId, { campaignCount: 1 });

    return campaign;
  }

  async findAllByUser(userId: Types.ObjectId): Promise<Campaign[]> {
    return this.campaignModel
      .find({ userId })
      .sort({ createdAt: -1 })
      .lean()
      .exec() as Promise<Campaign[]>;
  }

  /**
   * Internal use: get campaign by id (e.g. for workers). No userId check.
   */
  async getCampaignByIdInternal(
    campaignId: Types.ObjectId,
  ): Promise<Campaign | null> {
    if (!Types.ObjectId.isValid(campaignId.toString())) {
      return null;
    }
    const campaign = await this.campaignModel
      .findById(campaignId)
      .lean()
      .exec();
    return campaign as Campaign | null;
  }

  /**
   * Internal use: get a single campaign lead by campaign and lead ids. No userId check.
   */
  async getCampaignLeadByCampaignAndLead(
    campaignId: Types.ObjectId,
    leadId: Types.ObjectId,
  ): Promise<CampaignLeads | null> {
    if (
      !Types.ObjectId.isValid(campaignId.toString()) ||
      !Types.ObjectId.isValid(leadId.toString())
    ) {
      return null;
    }
    const campaignLead = await this.campaignLeadsModel
      .findOne({ campaignId, leadId })
      .lean()
      .exec();
    return campaignLead as CampaignLeads | null;
  }

  /**
   * Internal use: get a campaign lead by its _id (e.g. from inbound reply-to address cl-{id}@...).
   */
  async getCampaignLeadById(
    campaignLeadId: Types.ObjectId,
  ): Promise<CampaignLeads | null> {
    if (!Types.ObjectId.isValid(campaignLeadId.toString())) {
      return null;
    }
    const campaignLead = await this.campaignLeadsModel
      .findById(campaignLeadId)
      .select('campaignId leadId')
      .lean()
      .exec();
    return campaignLead as CampaignLeads | null;
  }

  /**
   * Marks a campaign lead as having received a reply and sets lead status to COMPLETED.
   * Used when an inbound webhook is processed. Then tries to mark the campaign COMPLETED if all leads are done.
   */
  async markReplyReceived(
    campaignId: Types.ObjectId,
    leadId: Types.ObjectId,
  ): Promise<void> {
    await this.campaignLeadsModel
      .updateOne(
        { campaignId, leadId },
        {
          $set: {
            isReplyReceived: true,
            replyReceivedAt: new Date(),
            status: CampaignLeadStatus.COMPLETED,
          },
        },
      )
      .exec();
    await this.tryMarkCampaignCompletedIfAllLeadsDone(campaignId);
  }

  /**
   * If no lead has status other than COMPLETED, mark the campaign as COMPLETED.
   */
  async tryMarkCampaignCompletedIfAllLeadsDone(
    campaignId: Types.ObjectId,
  ): Promise<void> {
    const hasIncompleteLead = await this.campaignLeadsModel
      .exists({
        campaignId,
        status: { $ne: CampaignLeadStatus.COMPLETED },
      })
      .exec();

    if (!hasIncompleteLead) {
      await this.campaignModel
        .updateOne(
          { _id: campaignId },
          { $set: { status: CampaignStatus.COMPLETED } },
        )
        .exec();
    }
  }

  async findOne(
    campaignId: Types.ObjectId,
    userId: Types.ObjectId,
  ): Promise<Campaign> {
    if (!Types.ObjectId.isValid(campaignId.toString())) {
      throw new BadRequestException('Invalid campaign id');
    }
    const campaign = await this.campaignModel
      .findOne({ _id: campaignId, userId })
      .lean()
      .exec();
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }
    return campaign as Campaign;
  }

  /**
   * Lightweight data for polling: campaign _id/status and leads with leadId, status, emailDraft, subjectDraft.
   */
  async findPollData(
    campaignId: Types.ObjectId,
    userId: Types.ObjectId,
  ): Promise<{
    campaign: { _id: Types.ObjectId; status: CampaignStatus };
    leads: Array<{
      leadId: Types.ObjectId;
      status: CampaignLeadStatus;
      emailDraft: string | undefined;
      subjectDraft: string | undefined;
      followupEmailDraft: string | undefined;
      followupSubjectDraft: string | undefined;
    }>;
  }> {
    const campaign = await this.campaignModel
      .findOne({ _id: campaignId, userId })
      .select('_id status')
      .lean()
      .exec();
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }
    const campaignLeads = await this.campaignLeadsModel
      .find({ campaignId })
      .select(
        'leadId status emailDraft subjectDraft followupEmailDraft followupSubjectDraft',
      )
      .lean()
      .exec();
    return {
      campaign: {
        _id: campaign._id as Types.ObjectId,
        status: campaign.status as CampaignStatus,
      },
      leads: campaignLeads.map((cl) => ({
        leadId: cl.leadId as Types.ObjectId,
        status: cl.status,
        emailDraft: cl.emailDraft,
        subjectDraft: cl.subjectDraft,
        followupEmailDraft: cl.followupEmailDraft,
        followupSubjectDraft: cl.followupSubjectDraft,
      })),
    };
  }

  async findCampaignLeadsWithLeads(
    campaignId: Types.ObjectId,
    userId: Types.ObjectId,
  ): Promise<CampaignLeads[]> {
    const campaign = await this.campaignModel
      .findOne({ _id: campaignId, userId })
      .exec();
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }
    const campaignLeads = await this.campaignLeadsModel
      .find({ campaignId })
      .populate('leadId')
      .lean()
      .exec();
    return campaignLeads as CampaignLeads[];
  }

  async updateSettings(
    campaignId: Types.ObjectId,
    userId: Types.ObjectId,
    dto: UpdateCampaignSettingsDto,
  ): Promise<Campaign> {
    if (!Types.ObjectId.isValid(campaignId.toString())) {
      throw new BadRequestException('Invalid campaign id');
    }
    const existing = await this.campaignModel
      .findOne({ _id: campaignId, userId })
      .lean()
      .exec();
    if (!existing) {
      throw new NotFoundException('Campaign not found');
    }
    const settings = { ...(existing.settings || {}), ...dto };
    const campaign = await this.campaignModel
      .findOneAndUpdate(
        { _id: campaignId, userId },
        { $set: { settings } },
        { new: true },
      )
      .lean()
      .exec();
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }
    return campaign as Campaign;
  }

  /**
   * Enqueue one job per lead to generate email drafts. Worker generates one draft per job.
   */
  async enqueueGenerateEmailDrafts(
    campaignId: Types.ObjectId,
    userId: Types.ObjectId,
  ): Promise<{ jobId: string }> {
    const campaign = await this.findOne(campaignId, userId);
    await this.campaignModel
      .updateOne(
        { _id: campaignId, userId },
        { $set: { status: CampaignStatus.EMAIL_DRAFT_GENERATION_STARTED } },
      )
      .exec();
    await this.campaignLeadsModel
      .updateMany(
        { campaignId },
        {
          $set: {
            status: CampaignLeadStatus.EMAIL_DRAFT_GENERATION_STARTED,
            ...(campaign.settings ? { settings: campaign.settings } : {}),
          },
        },
      )
      .exec();
    const campaignLeads = await this.campaignLeadsModel
      .find({ campaignId })
      .select('leadId')
      .lean()
      .exec();
    const jobs = await this.emailDraftsQueue.addBulk(
      campaignLeads.map((cl) => ({
        name: JOB_GENERATE_DRAFTS,
        data: {
          campaignId: campaignId.toString(),
          leadId: (cl.leadId as Types.ObjectId).toString(),
        } satisfies GenerateEmailDraftsJobPayload,
      })),
    );
    const firstJob = jobs[0];
    return { jobId: firstJob?.id ? String(firstJob.id) : '' };
  }

  /**
   * Launch campaign: enqueue one send-email job per lead. Email worker sends one email per job.
   */
  async launchCampaign(
    campaignId: Types.ObjectId,
    userId: Types.ObjectId,
  ): Promise<{ jobId: string }> {
    await this.findOne(campaignId, userId);
    await this.campaignModel
      .updateOne(
        { _id: campaignId, userId },
        { $set: { status: CampaignStatus.INITIAL_EMAILS_SEND_STARTED } },
      )
      .exec();
    await this.campaignLeadsModel
      .updateMany(
        { campaignId },
        {
          $set: {
            status: CampaignLeadStatus.INITIAL_EMAILS_SEND_STARTED,
          },
        },
      )
      .exec();
    const campaignLeads = await this.campaignLeadsModel
      .find({ campaignId })
      .select('leadId')
      .lean()
      .exec();
    const jobs = await this.sendEmailQueue.addBulk(
      campaignLeads.map((cl) => ({
        name: JOB_SEND_CAMPAIGN_EMAILS,
        data: {
          campaignId: campaignId.toString(),
          leadId: (cl.leadId as Types.ObjectId).toString(),
        } satisfies SendCampaignEmailsJobPayload,
      })),
    );
    const firstJob = jobs[0];
    return { jobId: firstJob?.id ? String(firstJob.id) : '' };
  }

  /**
   * Schedules a follow-up email job for a single campaign lead.
   * Called by EmailService after sending the initial email when follow-up is enabled.
   */
  async scheduleFollowUpEmail(
    campaignId: Types.ObjectId,
    leadId: Types.ObjectId,
  ): Promise<void> {
    const campaignLead = await this.getCampaignLeadByCampaignAndLead(
      campaignId,
      leadId,
    );
    if (!campaignLead?.settings?.isFollowUpEnabled) return;

    const delay = campaignLead.settings.followUpDelay ?? FollowUpDelay.TWO_DAYS;
    const delayMs = followUpDelayToMs(delay);

    const payload: SendFollowUpEmailJobPayload = {
      campaignId: campaignId.toString(),
      leadId: leadId.toString(),
    };
    await this.sendEmailQueue.add(JOB_SEND_FOLLOW_UP_EMAIL, payload, {
      delay: delayMs,
    });
  }
}

/** Converts FollowUpDelay enum to milliseconds for BullMQ delay. */
function followUpDelayToMs(delay: FollowUpDelay): number {
  const minute = 60 * 1000;
  const day = 24 * 60 * 60 * 1000;
  switch (delay) {
    case FollowUpDelay.ONE_MINUTE:
      return minute;
    case FollowUpDelay.THREE_MINUTES:
      return 3 * minute;
    case FollowUpDelay.FIVE_MINUTES:
      return 5 * minute;
    case FollowUpDelay.TWO_DAYS:
      return 2 * day;
    case FollowUpDelay.SEVEN_DAYS:
      return 7 * day;
    case FollowUpDelay.FOURTEEN_DAYS:
      return 14 * day;
    case FollowUpDelay.ONE_MONTH:
      return 30 * day;
    default:
      return 2 * day;
  }
}
