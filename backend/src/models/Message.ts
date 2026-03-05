import mongoose, { Schema, Document } from 'mongoose';

export interface IMessage extends Document {
  chatRoomId: mongoose.Types.ObjectId;
  senderId: mongoose.Types.ObjectId;
  receiverId: mongoose.Types.ObjectId;
  encryptedContent: string;
  senderEncryptedContent?: string;
  replyToMessageId?: mongoose.Types.ObjectId;
  timestamp: Date;
  delivered: boolean;
  read: boolean;
  deletedForEveryone: boolean;
  deletedForUsers: mongoose.Types.ObjectId[];
  savedForEveryone: boolean;
  exitedByUsers: mongoose.Types.ObjectId[];
  viewedByUsers: mongoose.Types.ObjectId[];
  deletedAt?: Date;
  reactions: Array<{
    userId: mongoose.Types.ObjectId;
    emoji: string;
    reactedAt: Date;
  }>;
}

const MessageSchema: Schema = new Schema({
  chatRoomId: {
    type: Schema.Types.ObjectId,
    ref: 'ChatRoom',
    required: true,
    index: true
  },
  senderId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  receiverId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  encryptedContent: {
    type: String,
    required: true
  },
  senderEncryptedContent: {
    type: String
  },
  replyToMessageId: {
    type: Schema.Types.ObjectId,
    ref: 'Message'
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  delivered: {
    type: Boolean,
    default: false
  },
  read: {
    type: Boolean,
    default: false
  },
  deletedForEveryone: {
    type: Boolean,
    default: false
  },
  deletedForUsers: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  savedForEveryone: {
    type: Boolean,
    default: false
  },
  exitedByUsers: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  viewedByUsers: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  deletedAt: {
    type: Date
  },
  reactions: [
    {
      userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
      },
      emoji: {
        type: String,
        required: true
      },
      reactedAt: {
        type: Date,
        default: Date.now
      }
    }
  ]
});

MessageSchema.path('reactions').default(() => []);

// Compound index for efficient message queries
MessageSchema.index({ chatRoomId: 1, timestamp: -1 });
MessageSchema.index({ chatRoomId: 1, deletedForUsers: 1, timestamp: -1 });
MessageSchema.index({ chatRoomId: 1, receiverId: 1, read: 1, deletedForEveryone: 1, timestamp: -1 });

export default mongoose.model<IMessage>('Message', MessageSchema);
