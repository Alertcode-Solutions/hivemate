import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const DEFAULT_MONGODB_URI = 'mongodb://localhost:27017/socialhive';
const RAW_MONGODB_URI = process.env.MONGODB_URI || DEFAULT_MONGODB_URI;
const MONGODB_URI = RAW_MONGODB_URI.trim();

export const connectDatabase = async (): Promise<void> => {
  try {
    if (RAW_MONGODB_URI !== MONGODB_URI) {
      console.warn('[DB] MONGODB_URI had surrounding whitespace and was sanitized.');
    }
    await mongoose.connect(MONGODB_URI);
    console.log('✅ MongoDB connected successfully');
    
    // Create geospatial index on locations
    const db = mongoose.connection.db;
    if (db) {
      await db.collection('locations').createIndex({ coordinates: '2dsphere' });
      console.log('✅ Geospatial index created on locations');
    }
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    process.exit(1);
  }
};

export const disconnectDatabase = async (): Promise<void> => {
  try {
    await mongoose.disconnect();
    console.log('✅ MongoDB disconnected');
  } catch (error) {
    console.error('❌ MongoDB disconnection error:', error);
  }
};

// Handle connection events
mongoose.connection.on('connected', () => {
  console.log('Mongoose connected to MongoDB');
});

mongoose.connection.on('error', (err) => {
  console.error('Mongoose connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.log('Mongoose disconnected from MongoDB');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  await disconnectDatabase();
  process.exit(0);
});
