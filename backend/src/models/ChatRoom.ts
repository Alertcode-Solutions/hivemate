import mongoose, { Schema, Document } from 'mongoose';

export interface IChatRoom extends Document {
  type: 'personal' | 'group';
  participants: mongoose.Types.ObjectId[];
  hiddenForUsers: mongoose.Types.ObjectId[];
  gigId?: mongoose.Types.ObjectId;
  createdAt: Date;
  lastMessageAt: Date;
}

const ChatRoomSchema: Schema = new Schema({
  type: {
    type: String,
    enum: ['personal', 'group'],
    required: true
  },
  participants: [{
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }],
  hiddenForUsers: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  gigId: {
    type: Schema.Types.ObjectId,
    ref: 'Gig'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastMessageAt: {
    type: Date,
    default: Date.now
  }
});

// Index for efficient participant queries
ChatRoomSchema.index({ participants: 1 });
ChatRoomSchema.index({ type: 1, participants: 1 });

export default mongoose.model<IChatRoom>('ChatRoom', ChatRoomSchema);
