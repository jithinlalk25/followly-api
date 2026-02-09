import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ collection: 'Company', versionKey: false, timestamps: true })
export class Company extends Document {
  declare _id: Types.ObjectId;

  @Prop({ required: true, ref: 'User', unique: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop()
  website: string;

  @Prop()
  description: string;

  /**
   * Testing: only these recipient emails receive actual outbound sends.
   * If set, any recipient not in this list is skipped silently (no email sent, rest of flow unchanged).
   */
  @Prop({ type: [String], default: [] })
  allowedEmailRecipients?: string[];
}

export const CompanySchema = SchemaFactory.createForClass(Company);
