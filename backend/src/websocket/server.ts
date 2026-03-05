import { Server as SocketIOServer } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { verifyToken } from '../utils/jwt';
import CallSession from '../models/CallSession';
import Notification from '../models/Notification';
import dotenv from 'dotenv';

dotenv.config();

const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

export class WebSocketServer {
  private io: SocketIOServer;
  private userSockets: Map<string, string> = new Map(); // userId -> socketId
  private userLastSeen: Map<string, Date> = new Map();
  private normalizeUserId(userId: any): string {
    if (!userId) return '';
    if (typeof userId === 'string') return userId;
    if (typeof userId === 'object' && userId._id) return String(userId._id);
    return String(userId);
  }

  constructor(httpServer: HTTPServer) {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: CORS_ORIGIN,
        credentials: false
      },
      path: '/socket.io'
    });

    this.setupMiddleware();
    this.setupEventHandlers();
  }

  private setupMiddleware() {
    // Authentication middleware
    this.io.use((socket, next) => {
      const token = socket.handshake.auth.token;

      if (!token) {
        return next(new Error('Authentication token required'));
      }

      try {
        const payload = verifyToken(token);
        (socket as any).userId = payload.userId;
        (socket as any).email = payload.email;
        next();
      } catch (error) {
        next(new Error('Invalid authentication token'));
      }
    });
  }

  private setupEventHandlers() {
    this.io.on('connection', (socket) => {
      const userId = (socket as any).userId;
      console.log(`✅ User connected: ${userId} (socket: ${socket.id})`);

      // Store user socket mapping
      this.userSockets.set(userId, socket.id);
      this.userLastSeen.set(userId, new Date());

      // Join user's personal room
      socket.join(`user:${userId}`);
      this.broadcast('presence:update', {
        userId,
        online: true,
        lastSeen: new Date()
      });

      // Handle disconnection
      socket.on('disconnect', () => {
        console.log(`❌ User disconnected: ${userId}`);
        this.userSockets.delete(userId);
        const lastSeen = new Date();
        this.userLastSeen.set(userId, lastSeen);
        this.broadcast('presence:update', {
          userId,
          online: false,
          lastSeen
        });
      });

      // Location update event
      socket.on('location:update', async (data) => {
        try {
          const { latitude, longitude, mode } = data;
          
          // Broadcast to nearby users (will be implemented in next task)
          socket.broadcast.emit('radar:update', {
            userId,
            latitude,
            longitude,
            mode,
            timestamp: new Date()
          });
        } catch (error) {
          console.error('Location update error:', error);
          socket.emit('error', { message: 'Failed to update location' });
        }
      });

      // Visibility toggle event
      socket.on('visibility:toggle', async (data) => {
        try {
          const { mode } = data;
          
          // Broadcast visibility change
          socket.broadcast.emit('user:visibility:changed', {
            userId,
            mode,
            timestamp: new Date()
          });
        } catch (error) {
          console.error('Visibility toggle error:', error);
          socket.emit('error', { message: 'Failed to toggle visibility' });
        }
      });

      // Send welcome message
      socket.emit('connected', {
        message: 'Connected to HiveMate',
        userId,
        timestamp: new Date()
      });

      // WebRTC signaling events
      socket.on('webrtc:offer', (data) => {
        const { targetUserId, offer, callId } = data;
        this.emitToUser(targetUserId, 'webrtc:offer', {
          fromUserId: userId,
          offer,
          callId
        });
      });

      socket.on('webrtc:answer', (data) => {
        const { targetUserId, answer, callId } = data;
        this.emitToUser(targetUserId, 'webrtc:answer', {
          fromUserId: userId,
          answer,
          callId
        });
      });

      socket.on('webrtc:ice-candidate', (data) => {
        const { targetUserId, candidate, callId } = data;
        this.emitToUser(targetUserId, 'webrtc:ice-candidate', {
          fromUserId: userId,
          candidate,
          callId
        });
      });

      socket.on('call:accept', async (data) => {
        const { callId, initiatorId } = data;
        try {
          await CallSession.findByIdAndUpdate(callId, {
            status: 'active',
            startedAt: new Date()
          });
          await Notification.deleteMany({
            userId,
            type: 'call_request',
            $or: [{ 'data.callId': String(callId) }, { 'data.callerId': String(initiatorId) }]
          });
        } catch (error) {
          console.error('Failed to mark call active:', error);
        }
        this.emitToUser(userId, 'notification:clear', {
          type: 'call_request',
          callId: String(callId),
          callerId: String(initiatorId || '')
        });
        this.emitToUser(initiatorId, 'call:accepted', {
          callId,
          acceptedBy: userId,
          timestamp: new Date()
        });
      });

      socket.on('call:reject', async (data) => {
        const { callId, initiatorId, reason } = data;
        try {
          await CallSession.findByIdAndUpdate(callId, {
            status: 'ended',
            endedAt: new Date()
          });
          await Notification.deleteMany({
            userId,
            type: 'call_request',
            $or: [{ 'data.callId': String(callId) }, { 'data.callerId': String(initiatorId) }]
          });
        } catch (error) {
          console.error('Failed to mark call ended on reject:', error);
        }
        this.emitToUser(userId, 'notification:clear', {
          type: 'call_request',
          callId: String(callId),
          callerId: String(initiatorId || '')
        });
        this.emitToUser(initiatorId, 'call:rejected', {
          callId,
          rejectedBy: userId,
          reason: reason || 'declined',
          timestamp: new Date()
        });
      });

      // Typing indicator events
      socket.on('typing:start', (data) => {
        const { targetUserId, chatRoomId } = data || {};
        if (!targetUserId || !chatRoomId) return;
        this.emitToUser(targetUserId, 'typing:start', {
          fromUserId: userId,
          chatRoomId,
          timestamp: new Date()
        });
      });

      socket.on('typing:stop', (data) => {
        const { targetUserId, chatRoomId } = data || {};
        if (!targetUserId || !chatRoomId) return;
        this.emitToUser(targetUserId, 'typing:stop', {
          fromUserId: userId,
          chatRoomId,
          timestamp: new Date()
        });
      });
    });
  }

  /**
   * Emit event to specific user
   */
  public emitToUser(userId: string, event: string, data: any) {
    const normalizedUserId = this.normalizeUserId(userId);
    if (!normalizedUserId) return;
    this.io.to(`user:${normalizedUserId}`).emit(event, data);
  }

  /**
   * Emit event to multiple users
   */
  public emitToUsers(userIds: string[], event: string, data: any) {
    userIds.forEach(userId => {
      this.emitToUser(userId, event, data);
    });
  }

  /**
   * Broadcast to all connected users
   */
  public broadcast(event: string, data: any) {
    this.io.emit(event, data);
  }

  /**
   * Get Socket.IO instance
   */
  public getIO(): SocketIOServer {
    return this.io;
  }

  /**
   * Check if user is connected
   */
  public isUserConnected(userId: string): boolean {
    const normalizedUserId = this.normalizeUserId(userId);
    return this.userSockets.has(normalizedUserId);
  }

  public getUserPresence(userId: string): { online: boolean; lastSeen: Date | null } {
    const normalizedUserId = this.normalizeUserId(userId);
    if (!normalizedUserId) {
      return { online: false, lastSeen: null };
    }

    const online = this.userSockets.has(normalizedUserId);
    return {
      online,
      lastSeen: online ? new Date() : this.userLastSeen.get(normalizedUserId) || null
    };
  }

  /**
   * Get connected users count
   */
  public getConnectedUsersCount(): number {
    return this.userSockets.size;
  }
}

let wsServer: WebSocketServer | null = null;

export const initializeWebSocket = (httpServer: HTTPServer): WebSocketServer => {
  wsServer = new WebSocketServer(httpServer);
  console.log('✅ WebSocket server initialized');
  return wsServer;
};

export const getWebSocketServer = (): WebSocketServer => {
  if (!wsServer) {
    throw new Error('WebSocket server not initialized');
  }
  return wsServer;
};
