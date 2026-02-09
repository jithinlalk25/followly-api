import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createClerkClient } from '@clerk/backend';
import { Model, Types } from 'mongoose';
import { User } from './schema/user.schema';
import { Summary } from './schema/summary.schema';

export type UserSummaryDto = {
  userId: Types.ObjectId;
  leadCount: number;
  campaignCount: number;
  emailReceivedCount: number;
  emailSentCount: number;
  emailDraftsCount: number;
};

export type UpdateSummaryDto = Partial<
  Omit<UserSummaryDto, 'userId'>
>;

@Injectable()
export class UserService {
  private readonly clerkClient = createClerkClient({
    secretKey: process.env.CLERK_SECRET_KEY,
  });

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Summary.name) private readonly summaryModel: Model<Summary>,
  ) {}

  async findById(userId: Types.ObjectId): Promise<User | null> {
    return this.userModel.findById(userId).lean().exec() as Promise<User | null>;
  }

  async getOrCreateByClerkUserId(clerkUserId: string): Promise<User> {
    const existing = await this.userModel.findOne({ clerkUserId }).exec();
    if (existing) return existing;

    const clerkUser = await this.clerkClient.users.getUser(clerkUserId);
    const name =
      [clerkUser.firstName, clerkUser.lastName]
        .filter(Boolean)
        .join(' ')
        .trim() || undefined;

    const doc = await this.userModel.create({ clerkUserId, name });
    await this.summaryModel.create({ userId: doc._id });
    return doc;
  }

  async getSummary(userId: Types.ObjectId): Promise<UserSummaryDto> {
    const summary = await this.summaryModel
      .findOne({ userId })
      .lean()
      .exec();
    if (summary) {
      return {
        userId: summary.userId,
        leadCount: summary.leadCount,
        campaignCount: summary.campaignCount,
        emailReceivedCount: summary.emailReceivedCount,
        emailSentCount: summary.emailSentCount,
        emailDraftsCount: summary.emailDraftsCount,
      };
    }
    return {
      userId,
      leadCount: 0,
      campaignCount: 0,
      emailReceivedCount: 0,
      emailSentCount: 0,
      emailDraftsCount: 0,
    };
  }

  /** Adds the given values to the existing summary fields. */
  async updateSummary(
    userId: Types.ObjectId,
    updates: UpdateSummaryDto,
  ): Promise<UserSummaryDto | null> {
    const doc = await this.summaryModel
      .findOneAndUpdate(
        { userId },
        { $inc: updates },
        { new: true, runValidators: true },
      )
      .lean()
      .exec();
    if (!doc) return null;
    return {
      userId: doc.userId,
      leadCount: doc.leadCount,
      campaignCount: doc.campaignCount,
      emailReceivedCount: doc.emailReceivedCount,
      emailSentCount: doc.emailSentCount,
      emailDraftsCount: doc.emailDraftsCount,
    };
  }
}
