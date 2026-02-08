import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Lead } from './schema/lead.schema';
import { AddLeadItemDto } from './dto/add-leads.dto';

@Injectable()
export class LeadService {
  constructor(
    @InjectModel(Lead.name) private readonly leadModel: Model<Lead>,
  ) {}

  async addLeads(
    userId: Types.ObjectId,
    items: AddLeadItemDto[],
  ): Promise<Lead[]> {
    if (items.length === 0) return [];
    const docs = items.map((item) => ({
      name: item.name,
      email: item.email,
      additionalInfo: item.additionalInfo,
      userId,
    }));
    const created = await this.leadModel.insertMany(docs);
    return created;
  }

  async getSummary(userId: Types.ObjectId): Promise<{ count: number }> {
    const count = await this.leadModel.countDocuments({ userId });
    return { count };
  }

  /** Returns a lead by id if it exists and belongs to the user, otherwise null. */
  async findOneByIdAndUserId(
    leadId: Types.ObjectId,
    userId: Types.ObjectId,
  ): Promise<Lead | null> {
    return this.leadModel
      .findOne({ _id: leadId, userId })
      .lean()
      .exec();
  }

  /** Returns how many of the given lead ids exist and belong to the user. */
  async countLeadsOwnedByUser(
    userId: Types.ObjectId,
    leadIds: Types.ObjectId[],
  ): Promise<number> {
    if (leadIds.length === 0) return 0;
    return this.leadModel.countDocuments({
      _id: { $in: leadIds },
      userId,
    });
  }

  async getLeads(
    userId: Types.ObjectId,
    page: number = 1,
    limit: number = 10,
  ): Promise<{
    data: Lead[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const skip = Math.max(0, (page - 1) * limit);
    const safeLimit = Math.min(Math.max(1, limit), 100);

    const [data, total] = await Promise.all([
      this.leadModel
        .find({ userId })
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(safeLimit)
        .lean()
        .exec(),
      this.leadModel.countDocuments({ userId }),
    ]);

    return {
      data: data as Lead[],
      total,
      page,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit) || 1,
    };
  }
}
