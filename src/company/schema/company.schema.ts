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
}

export const CompanySchema = SchemaFactory.createForClass(Company);
