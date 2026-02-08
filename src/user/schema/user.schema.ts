import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ collection: 'User', versionKey: false, timestamps: true })
export class User extends Document {
  declare _id: Types.ObjectId;

  @Prop({ required: true, unique: true })
  clerkUserId: string;

  @Prop({})
  name?: string;
}

export const UserSchema = SchemaFactory.createForClass(User);
