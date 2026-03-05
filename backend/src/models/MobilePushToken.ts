import mongoose, { Document, Schema } from 'mongoose';

export interface IMobilePushToken extends Document {
  userId: mongoose.Types.ObjectId;
  token: string;
  platform: 'android' | 'ios';
  createdAt: Date;
  updatedAt: Date;
}

const MobilePushTokenSchema: Schema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    token: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    platform: {
      type: String,
      enum: ['android', 'ios'],
      default: 'android',
      index: true
    }
  },
  {
    timestamps: true
  }
);

MobilePushTokenSchema.index({ userId: 1, updatedAt: -1 });

export default mongoose.model<IMobilePushToken>('MobilePushToken', MobilePushTokenSchema);

