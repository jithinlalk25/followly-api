import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createClerkClient } from '@clerk/backend';
import { Model, Types } from 'mongoose';
import { User } from './schema/user.schema';

@Injectable()
export class UserService {
  private readonly clerkClient = createClerkClient({
    secretKey: process.env.CLERK_SECRET_KEY,
  });

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
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
    return doc;
  }
}
