import { Request, Response } from 'express';
import mongoose from 'mongoose';
import Message from '../models/Message';
import Notification from '../models/Notification';
import { ChatService } from '../services/chatService';
import { InteractionService } from '../services/interactionService';
import { NotificationService } from '../services/notificationService';
import { getWebSocketServer } from '../websocket/server';
import Profile from '../models/Profile';
import Friendship from '../models/Friendship';

const DELETED_MESSAGE_TEXT = 'This message was deleted';

export const sendMessage = async (req: Request, res: Response) => {
  try {
    const senderId = (req as any).userId;
    const { receiverId, encryptedContent, senderEncryptedContent, chatRoomId, replyToMessageId } = req.body;

    if (!receiverId || !encryptedContent) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Receiver ID and encrypted content are required',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Get or create chat room
    let roomId = chatRoomId;
    if (!roomId) {
      const chatRoom = await ChatService.getOrCreatePersonalChatRoom(senderId, receiverId);
      roomId = chatRoom._id.toString();
    }

    // Verify sender is participant
    const isParticipant = await ChatService.isParticipant(roomId, senderId);
    if (!isParticipant) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'You are not a participant in this chat',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Create message
    const message = new Message({
      chatRoomId: roomId,
      senderId,
      receiverId,
      encryptedContent,
      senderEncryptedContent: senderEncryptedContent || encryptedContent,
      replyToMessageId: replyToMessageId || undefined,
      timestamp: new Date(),
      delivered: false,
      read: false
    });

    await message.save();

    // Update chat room last message time
    await ChatService.updateLastMessageTime(roomId);

    // Increment interaction count
    try {
      await InteractionService.incrementInteraction(senderId, receiverId);
    } catch (interactionError) {
      console.error('Interaction tracking error:', interactionError);
    }

    // Send via WebSocket
    try {
      const wsServer = getWebSocketServer();
      const senderProfile = await Profile.findOne({ userId: senderId });
      
      wsServer.emitToUser(receiverId, 'message:receive', {
        messageId: message._id,
        chatRoomId: roomId,
        senderId,
        senderName: senderProfile?.name,
        encryptedContent,
        timestamp: message.timestamp
      });

      // Persist + realtime notification from one place to avoid duplicates/missed reload.
      if (mongoose.connection.readyState === 1) {
        void NotificationService.notifyMessage(
          receiverId,
          senderProfile?.name || 'Someone',
          senderId,
          {
            messageId: message._id,
            chatRoomId: roomId
          }
        ).catch((notificationError) => {
          console.error('Notification dispatch error:', notificationError);
        });
      } else {
        wsServer.emitToUser(receiverId, 'notification:new', {
          type: 'message',
          title: 'New message',
          message: `${senderProfile?.name || 'Someone'} sent you a message`,
          data: {
            messageId: message._id,
            chatRoomId: roomId,
            senderId
          },
          timestamp: new Date()
        });
      }

      // Mark as delivered
      message.delivered = true;
      await message.save();
    } catch (wsError) {
      console.error('WebSocket send error:', wsError);
    }

    res.status(201).json({
      message: 'Message sent successfully',
      messageData: {
        id: message._id,
        chatRoomId: roomId,
        senderId: message.senderId,
        receiverId: message.receiverId,
        timestamp: message.timestamp,
        delivered: message.delivered,
        replyToMessageId: message.replyToMessageId || null,
        reactions: []
      }
    });
  } catch (error: any) {
    if (error.message === 'Users must be friends to chat') {
      return res.status(403).json({
        error: {
          code: 'NOT_FRIENDS',
          message: error.message,
          timestamp: new Date().toISOString()
        }
      });
    }

    console.error('Send message error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred while sending message',
        timestamp: new Date().toISOString()
      }
    });
  }
};

export const getChatHistory = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { chatRoomId } = req.params;
    const { limit = 50, before } = req.query;

    // Verify user is participant
    const isParticipant = await ChatService.isParticipant(chatRoomId, userId);
    if (!isParticipant) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'You are not a participant in this chat',
          timestamp: new Date().toISOString()
        }
      });
    }

    // Build query
    const query: any = { chatRoomId };
    query.deletedForUsers = { $ne: userId };
    if (before) {
      query.timestamp = { $lt: new Date(before as string) };
    }

    // Get messages
    const messages = await Message.find(query)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit as string));

    // Mark messages as read
    await Message.updateMany(
      {
        chatRoomId,
        receiverId: userId,
        read: false
      },
      { read: true }
    );

    // Remove message notifications for this conversation once user has opened/read it.
    const otherParticipantIds = Array.from(
      new Set(
        messages
          .map((m) => m.senderId?.toString())
          .filter((id) => Boolean(id) && id !== userId)
      )
    );

    const messageNotificationQuery: any = {
      userId,
      type: 'message',
      $or: [{ 'data.chatRoomId': chatRoomId }]
    };

    if (otherParticipantIds.length > 0) {
      messageNotificationQuery.$or.push({
        'data.senderId': { $in: otherParticipantIds }
      });
    }

    await Notification.deleteMany(messageNotificationQuery);

    res.json({
      messages: messages.reverse().map(msg => ({
        id: msg._id,
        senderId: msg.senderId,
        receiverId: msg.receiverId,
        encryptedContent:
          msg.senderId.toString() === userId
            ? (msg.senderEncryptedContent || msg.encryptedContent)
            : msg.encryptedContent,
        replyToMessageId: msg.replyToMessageId || null,
        timestamp: msg.timestamp,
        delivered: msg.delivered,
        read: msg.read,
        deletedForEveryone: msg.deletedForEveryone,
        reactions: (msg.reactions || []).map((reaction: any) => ({
          userId: reaction.userId,
          emoji: reaction.emoji,
          reactedAt: reaction.reactedAt
        }))
      })),
      total: messages.length,
      hasMore: messages.length === parseInt(limit as string)
    });
  } catch (error: any) {
    console.error('Get chat history error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred while fetching chat history',
        timestamp: new Date().toISOString()
      }
    });
  }
};

export const getUserChats = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;

    // Backfill legacy data: ensure personal chat rooms exist for all active friendships.
    const friendships = await Friendship.find({
      $or: [{ user1Id: userId }, { user2Id: userId }],
      blocked: false
    });

    await Promise.all(
      friendships.map((friendship) => {
        const friendId =
          friendship.user1Id.toString() === userId
            ? friendship.user2Id.toString()
            : friendship.user1Id.toString();
        return ChatService.getOrCreatePersonalChatRoom(userId, friendId);
      })
    );

    const chatRooms = await ChatService.getUserChatRooms(userId);

    // Get last message for each chat
    const chatsWithMessages = await Promise.all(
      chatRooms.map(async (room) => {
        const lastMessage = await Message.findOne({ chatRoomId: room._id })
          .where('deletedForUsers').ne(userId)
          .sort({ timestamp: -1 });

        // Get other participant(s)
        const otherParticipants = room.participants.filter(
          p => p.toString() !== userId
        );

        const profiles = await Profile.find({
          userId: { $in: otherParticipants }
        });

        return {
          chatRoomId: room._id,
          type: room.type,
          participants: profiles.map(p => ({
            userId: p.userId,
            name: p.name,
            profession: p.profession
          })),
          lastMessage: lastMessage ? {
            encryptedContent: lastMessage.encryptedContent,
            timestamp: lastMessage.timestamp,
            senderId: lastMessage.senderId
          } : null,
          lastMessageAt: room.lastMessageAt,
          unreadCount: await Message.countDocuments({
            chatRoomId: room._id,
            receiverId: userId,
            read: false,
            deletedForEveryone: { $ne: true },
            deletedForUsers: { $ne: userId }
          })
        };
      })
    );

    res.json({
      chats: chatsWithMessages,
      total: chatsWithMessages.length
    });
  } catch (error: any) {
    console.error('Get user chats error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred while fetching chats',
        timestamp: new Date().toISOString()
      }
    });
  }
};

export const reactToMessage = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { messageId } = req.params;
    const { emoji } = req.body || {};

    if (!emoji || typeof emoji !== 'string' || !emoji.trim()) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Emoji is required',
          timestamp: new Date().toISOString()
        }
      });
    }

    const normalizedEmoji = emoji.trim().slice(0, 12);
    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({
        error: {
          code: 'MESSAGE_NOT_FOUND',
          message: 'Message not found',
          timestamp: new Date().toISOString()
        }
      });
    }

    const isParticipant = await ChatService.isParticipant(message.chatRoomId.toString(), userId);
    if (!isParticipant) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'You are not allowed to react to this message',
          timestamp: new Date().toISOString()
        }
      });
    }

    const existingReaction = (message.reactions || []).find(
      (reaction: any) => reaction.userId?.toString() === userId
    );
    if (existingReaction) {
      existingReaction.emoji = normalizedEmoji;
      existingReaction.reactedAt = new Date();
    } else {
      (message.reactions as any).push({
        userId,
        emoji: normalizedEmoji,
        reactedAt: new Date()
      });
    }
    await message.save();

    try {
      const wsServer = getWebSocketServer();
      wsServer.emitToUsers(
        [message.senderId.toString(), message.receiverId.toString()],
        'message:reaction',
        {
          messageId: message._id,
          chatRoomId: message.chatRoomId,
          reactions: message.reactions
        }
      );
    } catch (wsError) {
      console.error('Reaction socket emit error:', wsError);
    }

    return res.json({
      message: 'Reaction updated',
      messageId: message._id,
      reactions: message.reactions
    });
  } catch (error: any) {
    console.error('React to message error:', error);
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred while reacting to message',
        timestamp: new Date().toISOString()
      }
    });
  }
};

export const removeReactionFromMessage = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { messageId } = req.params;

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({
        error: {
          code: 'MESSAGE_NOT_FOUND',
          message: 'Message not found',
          timestamp: new Date().toISOString()
        }
      });
    }

    const isParticipant = await ChatService.isParticipant(message.chatRoomId.toString(), userId);
    if (!isParticipant) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'You are not allowed to modify reaction for this message',
          timestamp: new Date().toISOString()
        }
      });
    }

    message.reactions = (message.reactions || []).filter(
      (reaction: any) => reaction.userId?.toString() !== userId
    ) as any;
    await message.save();

    try {
      const wsServer = getWebSocketServer();
      wsServer.emitToUsers(
        [message.senderId.toString(), message.receiverId.toString()],
        'message:reaction',
        {
          messageId: message._id,
          chatRoomId: message.chatRoomId,
          reactions: message.reactions
        }
      );
    } catch (wsError) {
      console.error('Reaction remove socket emit error:', wsError);
    }

    return res.json({
      message: 'Reaction removed',
      messageId: message._id,
      reactions: message.reactions
    });
  } catch (error: any) {
    console.error('Remove reaction error:', error);
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred while removing reaction',
        timestamp: new Date().toISOString()
      }
    });
  }
};

export const openPersonalChat = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { friendId } = req.params;

    if (!friendId) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Friend ID is required',
          timestamp: new Date().toISOString()
        }
      });
    }

    const chatRoom = await ChatService.getOrCreatePersonalChatRoom(userId, friendId);
    const friendProfile = await Profile.findOne({ userId: friendId }).lean();

    res.json({
      chat: {
        chatRoomId: chatRoom._id,
        type: chatRoom.type,
        participants: friendProfile
          ? [{
              userId: friendProfile.userId,
              name: friendProfile.name,
              profession: friendProfile.profession
            }]
          : [],
        lastMessage: null,
        lastMessageAt: chatRoom.lastMessageAt
      }
    });
  } catch (error: any) {
    if (error.message === 'Users must be friends to chat') {
      return res.status(403).json({
        error: {
          code: 'NOT_FRIENDS',
          message: error.message,
          timestamp: new Date().toISOString()
        }
      });
    }
    console.error('Open personal chat error:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred while opening chat',
        timestamp: new Date().toISOString()
      }
    });
  }
};

export const deleteMessageForMe = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { messageId } = req.params;

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({
        error: {
          code: 'MESSAGE_NOT_FOUND',
          message: 'Message not found',
          timestamp: new Date().toISOString()
        }
      });
    }

    const isParticipant = await ChatService.isParticipant(message.chatRoomId.toString(), userId);
    if (!isParticipant) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'You are not allowed to delete this message',
          timestamp: new Date().toISOString()
        }
      });
    }

    const alreadyDeleted = message.deletedForUsers.some((id) => id.toString() === userId);
    if (!alreadyDeleted) {
      message.deletedForUsers.push(userId as any);
      await message.save();
    }

    return res.json({
      message: 'Message deleted for you',
      messageId: message._id
    });
  } catch (error: any) {
    console.error('Delete message for me error:', error);
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred while deleting message',
        timestamp: new Date().toISOString()
      }
    });
  }
};

export const deleteMessageForEveryone = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    const { messageId } = req.params;

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({
        error: {
          code: 'MESSAGE_NOT_FOUND',
          message: 'Message not found',
          timestamp: new Date().toISOString()
        }
      });
    }

    if (message.senderId.toString() !== userId) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Only sender can delete message for everyone',
          timestamp: new Date().toISOString()
        }
      });
    }

    message.deletedForEveryone = true;
    message.encryptedContent = DELETED_MESSAGE_TEXT;
    message.senderEncryptedContent = DELETED_MESSAGE_TEXT;
    message.deletedAt = new Date();
    await message.save();

    try {
      const wsServer = getWebSocketServer();
      wsServer.emitToUsers(
        [message.senderId.toString(), message.receiverId.toString()],
        'message:deleted_for_everyone',
        {
          messageId: message._id,
          chatRoomId: message.chatRoomId,
          deletedAt: message.deletedAt
        }
      );
    } catch (wsError) {
      console.error('WebSocket delete notification error:', wsError);
    }

    return res.json({
      message: 'Message deleted for everyone',
      messageId: message._id
    });
  } catch (error: any) {
    console.error('Delete message for everyone error:', error);
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An error occurred while deleting message',
        timestamp: new Date().toISOString()
      }
    });
  }
};
