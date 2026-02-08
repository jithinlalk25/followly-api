import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export enum EmailDirection {
  OUTBOUND = 'OUTBOUND', // sent to the lead
  INBOUND = 'INBOUND', // received from the lead
}

@Schema({ collection: 'Email', versionKey: false, timestamps: true })
export class Email extends Document {
  declare _id: Types.ObjectId;

  @Prop({ required: true, ref: 'Lead' })
  leadId: Types.ObjectId;

  @Prop({ required: true, ref: 'Campaign' })
  campaignId: Types.ObjectId;

  @Prop({ required: true, enum: EmailDirection })
  direction: EmailDirection;

  @Prop({ required: true })
  subject: string;

  @Prop({ required: true })
  body: string;
}

export const EmailSchema = SchemaFactory.createForClass(Email);

// List emails by lead, sorted by creation (email.service getEmailsByLead). distinct('leadId') also benefits from leadId index.
EmailSchema.index({ leadId: 1, createdAt: -1 });
