import { Request, Response } from 'express';
import { generateKeyPairSync } from 'crypto';
import mongoose from 'mongoose';
import EncryptionKey from '../models/EncryptionKey';

const createSerializedRsaKeyPair = () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicExponent: 0x10001,
    publicKeyEncoding: {
      type: 'spki',
      format: 'der'
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'der'
    }
  });

  return {
    publicKey: publicKey.toString('base64'),
    privateKey: privateKey.toString('base64')
  };
};

export const exchangePublicKey = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { publicKey, privateKey } = req.body;

    if (!publicKey) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Public key is required',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Store or update public key
    await EncryptionKey.findOneAndUpdate(
      { userId },
      { userId, publicKey, privateKey: privateKey || '', createdAt: new Date() },
      { upsert: true, new: true }
    );

    res.json({
      message: 'Public key stored successfully',
      userId
    });
  } catch (error: any) {
    console.error('Exchange public key error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred while storing public key',
        timestamp: new Date().toISOString()
      }
    });
  }
};

export const getMyKeyPair = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const encryptionKey = await EncryptionKey.findOne({ userId });

    if (!encryptionKey || !encryptionKey.publicKey || !encryptionKey.privateKey) {
      return res.status(404).json({
        error: {
          code: 'KEY_NOT_FOUND',
          message: 'Key pair not found for this user',
          timestamp: new Date().toISOString()
        }
      });
    }

    res.json({
      userId: encryptionKey.userId,
      publicKey: encryptionKey.publicKey,
      privateKey: encryptionKey.privateKey,
      createdAt: encryptionKey.createdAt
    });
  } catch (error: any) {
    console.error('Get key pair error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred while fetching key pair',
        timestamp: new Date().toISOString()
      }
    });
  }
};

export const getPublicKey = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid user ID',
          timestamp: new Date().toISOString()
        }
      });
    }

    let encryptionKey = await EncryptionKey.findOne({ userId });
    if (!encryptionKey || !encryptionKey.publicKey || !encryptionKey.privateKey) {
      const generated = createSerializedRsaKeyPair();
      encryptionKey = await EncryptionKey.findOneAndUpdate(
        { userId },
        {
          userId,
          publicKey: generated.publicKey,
          privateKey: generated.privateKey,
          createdAt: new Date()
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }
    if (!encryptionKey) {
      return res.status(500).json({
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Could not provision encryption key',
          timestamp: new Date().toISOString()
        }
      });
    }

    res.json({
      userId: encryptionKey.userId,
      publicKey: encryptionKey.publicKey,
      createdAt: encryptionKey.createdAt
    });
  } catch (error: any) {
    console.error('Get public key error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred while fetching public key',
        timestamp: new Date().toISOString()
      }
    });
  }
};
