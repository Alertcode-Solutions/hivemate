import ChatRoom from '../models/ChatRoom';
import Friendship from '../models/Friendship';

export class ChatService {
  /**
   * Get or create personal chat room between two users
   */
  static async getOrCreatePersonalChatRoom(user1Id: string, user2Id: string) {
    // Check if friendship exists
    const friendship = await Friendship.findOne({
      $or: [
        { user1Id, user2Id },
        { user1Id: user2Id, user2Id: user1Id }
      ],
      blocked: false
    });

    if (!friendship) {
      throw new Error('Users must be friends to chat');
    }

    // Check if chat room already exists
    let chatRoom = await ChatRoom.findOne({
      type: 'personal',
      participants: { $all: [user1Id, user2Id] }
    });

    // Create if doesn't exist
    if (!chatRoom) {
      chatRoom = new ChatRoom({
        type: 'personal',
        participants: [user1Id, user2Id],
        createdAt: new Date(),
        lastMessageAt: new Date()
      });
      await chatRoom.save();
    }

    return chatRoom;
  }

  /**
   * Create group chat room for a gig
   */
  static async createGroupChatRoom(gigId: string, participants: string[]) {
    const chatRoom = new ChatRoom({
      type: 'group',
      participants,
      gigId,
      createdAt: new Date(),
      lastMessageAt: new Date()
    });

    await chatRoom.save();
    return chatRoom;
  }

  /**
   * Get user's chat rooms
   */
  static async getUserChatRooms(userId: string) {
    return await ChatRoom.find({
      participants: userId,
      hiddenForUsers: { $ne: userId }
    }).sort({ lastMessageAt: -1 });
  }

  /**
   * Check if user is participant in chat room
   */
  static async isParticipant(chatRoomId: string, userId: string): Promise<boolean> {
    const chatRoom = await ChatRoom.findById(chatRoomId);
    if (!chatRoom) return false;
    
    return chatRoom.participants.some(p => p.toString() === userId);
  }

  /**
   * Update last message timestamp
   */
  static async updateLastMessageTime(chatRoomId: string, unhideUserIds: string[] = []) {
    const update: any = {
      lastMessageAt: new Date()
    };
    if (unhideUserIds.length > 0) {
      update.$pull = {
        hiddenForUsers: { $in: unhideUserIds }
      };
    }
    await ChatRoom.findByIdAndUpdate(chatRoomId, update);
  }
}
