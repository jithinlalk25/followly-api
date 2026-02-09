import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ collection: 'Summary', versionKey: false, timestamps: true })
export class Summary extends Document {
  declare _id: Types.ObjectId;

  @Prop({ required: true, unique: true, ref: 'User' })
  userId: Types.ObjectId;

  @Prop({ required: true, default: 0 })
  leadCount: number;

  @Prop({ required: true, default: 0 })
  campaignCount: number;

  @Prop({ required: true, default: 0 })
  emailReceivedCount: number;

  @Prop({ required: true, default: 0 })
  emailSentCount: number;

  @Prop({ required: true, default: 0 })
  emailDraftsCount: number;
}

export const SummarySchema = SchemaFactory.createForClass(Summary);
