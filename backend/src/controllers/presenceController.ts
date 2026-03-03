import { Request, Response } from 'express';
import { getWebSocketServer } from '../websocket/server';

export const getPresence = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'User ID is required',
          timestamp: new Date().toISOString()
        }
      });
    }

    const wsServer = getWebSocketServer();
    const presence = wsServer.getUserPresence(userId);
    return res.json({
      userId,
      online: presence.online,
      lastSeen: presence.lastSeen
    });
  } catch (error) {
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch presence',
        timestamp: new Date().toISOString()
      }
    });
  }
};

