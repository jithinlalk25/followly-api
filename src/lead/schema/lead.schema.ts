import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

@Schema({ collection: 'Lead', versionKey: false, timestamps: true })
export class Lead extends Document {
  declare _id: Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  email: string;

  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  additionalInfo: Record<string, string>;

  @Prop({ required: true, ref: 'User' })
  userId: Types.ObjectId;
}

export const LeadSchema = SchemaFactory.createForClass(Lead);

// Unique lead per user+email (addLeads).
LeadSchema.index({ userId: 1, email: 1 }, { unique: true });
// List/count by user, sorted by creation (lead.service getLeads, getSummary).
LeadSchema.index({ userId: 1, createdAt: -1 });
