import mongoose, { Schema, Document } from 'mongoose';

export interface IProfile extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  username: string;
  age: number;
  gender: 'male' | 'female' | 'other';
  religion: string;
  religionOther?: string;
  phone: string;
  place: string;
  skills: string[];
  profession: string;
  photos: string[];
  coverPhoto?: string;
  bio: string;
  college?: string;
  company?: string;
  verified: boolean;
  websiteUrl?: string;
  achievements?: string[];
  optimizedKeywords: string[];
  createdAt: Date;
  updatedAt: Date;
}

const ProfileSchema: Schema = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  username: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    unique: true,
    index: true
  },
  age: {
    type: Number,
    required: true,
    min: 18,
    max: 120
  },
  gender: {
    type: String,
    required: true,
    enum: ['male', 'female', 'other']
  },
  religion: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  religionOther: {
    type: String,
    trim: true
  },
  phone: {
    type: String,
    required: true,
    trim: true
  },
  place: {
    type: String,
    required: true,
    trim: true
  },
  skills: {
    type: [String],
    required: true,
    index: true
  },
  profession: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  photos: {
    type: [String],
    default: [],
    validate: {
      validator: function(v: string[]) {
        return v.length <= 5;
      },
      message: 'Maximum 5 photos allowed'
    }
  },
  coverPhoto: {
    type: String,
    trim: true
  },
  bio: {
    type: String,
    required: true,
    maxlength: 500
  },
  college: {
    type: String,
    trim: true
  },
  company: {
    type: String,
    trim: true
  },
  verified: {
    type: Boolean,
    default: false
  },
  websiteUrl: {
    type: String,
    trim: true
  },
  achievements: {
    type: [String],
    default: []
  },
  optimizedKeywords: {
    type: [String],
    default: [],
    index: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update the updatedAt timestamp before saving
ProfileSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Text index for bio search
ProfileSchema.index({ bio: 'text', optimizedKeywords: 'text' });

export default mongoose.model<IProfile>('Profile', ProfileSchema);
