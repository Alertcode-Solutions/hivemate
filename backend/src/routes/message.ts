import { Router } from 'express';
import {
  sendMessage,
  getChatHistory,
  getUserChats,
  openPersonalChat,
  deleteChatForMe,
  deleteMessageForMe,
  deleteMessageForEveryone,
  reactToMessage,
  removeReactionFromMessage,
  saveMessageForMe,
  unsaveMessageForMe,
  expireViewedUnsavedMessagesForMe,
  markMessageViewed,
  markChatRead
} from '../controllers/messageController';
import { authenticate } from '../middleware/auth';

const router = Router();

// All message routes require authentication
router.post('/', authenticate, sendMessage);
router.get('/chats', authenticate, getUserChats);
router.delete('/chats/:chatRoomId/me', authenticate, deleteChatForMe);
router.post('/open/:friendId', authenticate, openPersonalChat);
router.get('/chat/:chatRoomId', authenticate, getChatHistory);
router.post('/chat/:chatRoomId/exit', authenticate, expireViewedUnsavedMessagesForMe);
router.post('/chat/:chatRoomId/read', authenticate, markChatRead);
router.delete('/:messageId/me', authenticate, deleteMessageForMe);
router.delete('/:messageId/everyone', authenticate, deleteMessageForEveryone);
router.put('/:messageId/save', authenticate, saveMessageForMe);
router.delete('/:messageId/save', authenticate, unsaveMessageForMe);
router.post('/:messageId/viewed', authenticate, markMessageViewed);
router.put('/:messageId/reaction', authenticate, reactToMessage);
router.delete('/:messageId/reaction', authenticate, removeReactionFromMessage);

export default router;
