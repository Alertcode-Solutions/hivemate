import { Request, Response } from 'express';
import mongoose from 'mongoose';
import CallSession from '../models/CallSession';
import { InteractionService } from '../services/interactionService';
import { getWebSocketServer } from '../websocket/server';
import Profile from '../models/Profile';
import { NotificationService } from '../services/notificationService';

export const initiateCall = async (req: Request, res: Response) => {
  try {
    const initiatorId = (req as any).userId;
    const { participantId, type } = req.body;
    const now = new Date();
    const staleRingingThreshold = new Date(now.getTime() - 70 * 1000); // 70s
    const staleActiveThreshold = new Date(now.getTime() - 6 * 60 * 60 * 1000); // 6h

    if (!participantId || !type) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Participant ID and call type are required',
          timestamp: new Date().toISOString()
        }
      });
    }

    if (!['voice', 'video'].includes(type)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_TYPE',
          message: 'Call type must be either "voice" or "video"',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Check if voice is unlocked
    if (type === 'voice') {
      const voiceUnlocked = await InteractionService.isVoiceUnlocked(initiatorId, participantId);
      if (!voiceUnlocked) {
        return res.status(403).json({
          error: {
            code: 'VOICE_LOCKED',
            message: 'Voice calls require at least 2 interactions with this user',
            timestamp: new Date().toISOString()
          }
        });
      }
    }

    // Check if video is unlocked
    if (type === 'video') {
      const videoUnlocked = await InteractionService.isVideoUnlocked(initiatorId, participantId);
      if (!videoUnlocked) {
        return res.status(403).json({
          error: {
            code: 'VIDEO_LOCKED',
            message: 'Video calls require an active subscription',
            timestamp: new Date().toISOString()
          }
        });
      }
    }

    // Cleanup stale sessions first so "user already on another call" is accurate.
    await CallSession.updateMany(
      {
        status: 'ringing',
        createdAt: { $lt: staleRingingThreshold }
      },
      {
        $set: {
          status: 'ended',
          endedAt: now
        }
      }
    );

    await CallSession.updateMany(
      {
        status: 'active',
        startedAt: { $exists: true, $lt: staleActiveThreshold }
      },
      {
        $set: {
          status: 'ended',
          endedAt: now
        }
      }
    );

    // Prevent parallel ringing/active calls for either participant.
    const existingSession = await CallSession.findOne({
      $and: [
        {
          $or: [
            { status: 'active' },
            { status: 'ringing', createdAt: { $gte: staleRingingThreshold } }
          ]
        },
        {
          $or: [
            { initiatorId, participantIds: participantId },
            { initiatorId: participantId, participantIds: initiatorId },
            { initiatorId },
            { initiatorId: participantId },
            { participantIds: initiatorId },
            { participantIds: participantId }
          ]
        }
      ]
    }).sort({ createdAt: -1 });

    if (existingSession) {
      return res.status(409).json({
        error: {
          code: 'CALL_BUSY',
          message: 'One of the users is already on another call',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Create call session
    const callSession = new CallSession({
      type,
      initiatorId,
      participantIds: [participantId],
      status: 'ringing',
      createdAt: new Date()
    });

    await callSession.save();

    const initiatorProfile = mongoose.isValidObjectId(initiatorId)
      ? await Profile.findOne({ userId: initiatorId })
      : null;

    // Send call notification via WebSocket
    try {
      const wsServer = getWebSocketServer();
      wsServer.emitToUser(participantId, 'call:incoming', {
        callId: callSession._id,
        type,
        initiatorId,
        initiatorName: initiatorProfile?.name,
        timestamp: new Date()
      });
    } catch (wsError) {
      console.error('WebSocket call notification error:', wsError);
    }

    try {
      await NotificationService.notifyCallRequest(
        participantId,
        initiatorProfile?.name || 'Someone',
        String(initiatorId),
        type,
        String(callSession._id)
      );
    } catch (notificationError) {
      console.error('Call notification persistence/push error:', notificationError);
    }

    res.status(201).json({
      message: 'Call initiated successfully',
      call: {
        id: callSession._id,
        type: callSession.type,
        status: callSession.status,
        createdAt: callSession.createdAt
      }
    });
  } catch (error: any) {
    console.error('Initiate call error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred while initiating call',
        timestamp: new Date().toISOString()
      }
    });
  }
};

export const endCall = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { callId } = req.params;

    const callSession = await CallSession.findById(callId);
    if (!callSession) {
      return res.status(404).json({
        error: {
          code: 'CALL_NOT_FOUND',
          message: 'Call session not found',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Check authorization
    const isParticipant = 
      callSession.initiatorId.toString() === userId ||
      callSession.participantIds.some(p => p.toString() === userId);

    if (!isParticipant) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'You are not a participant in this call',
          timestamp: new Date().toISOString()
        }
      });
    }

    // End call
    callSession.status = 'ended';
    callSession.endedAt = new Date();
    await callSession.save();

    // Notify other participants
    try {
      const wsServer = getWebSocketServer();
      const otherParticipants = [
        callSession.initiatorId.toString(),
        ...callSession.participantIds.map(p => p.toString())
      ].filter(id => id !== userId);

      wsServer.emitToUsers(otherParticipants, 'call:ended', {
        callId: callSession._id,
        endedBy: userId,
        timestamp: new Date()
      });
    } catch (wsError) {
      console.error('WebSocket call end notification error:', wsError);
    }

    res.json({
      message: 'Call ended successfully',
      call: {
        id: callSession._id,
        status: callSession.status,
        endedAt: callSession.endedAt
      }
    });
  } catch (error: any) {
    console.error('End call error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred while ending call',
        timestamp: new Date().toISOString()
      }
    });
  }
};

export const getCommunicationLevel = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { friendId } = req.params;

    const friendship = await InteractionService.getFriendship(userId, friendId);
    if (!friendship) {
      return res.status(404).json({
        error: {
          code: 'FRIENDSHIP_NOT_FOUND',
          message: 'Friendship not found',
          timestamp: new Date().toISOString()
        }
      });
    }

    const voiceUnlocked = await InteractionService.isVoiceUnlocked(userId, friendId);
    const videoUnlocked = await InteractionService.isVideoUnlocked(userId, friendId);

    res.json({
      communicationLevel: friendship.communicationLevel,
      interactionCount: friendship.interactionCount,
      capabilities: {
        chat: true,
        voice: voiceUnlocked,
        video: videoUnlocked
      }
    });
  } catch (error: any) {
    console.error('Get communication level error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred while fetching communication level',
        timestamp: new Date().toISOString()
      }
    });
  }
};
