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
  removeReactionFromMessage
} from '../controllers/messageController';
import { authenticate } from '../middleware/auth';

const router = Router();

// All message routes require authentication
router.post('/', authenticate, sendMessage);
router.get('/chats', authenticate, getUserChats);
router.delete('/chats/:chatRoomId/me', authenticate, deleteChatForMe);
router.post('/open/:friendId', authenticate, openPersonalChat);
router.get('/chat/:chatRoomId', authenticate, getChatHistory);
router.delete('/:messageId/me', authenticate, deleteMessageForMe);
router.delete('/:messageId/everyone', authenticate, deleteMessageForEveryone);
router.put('/:messageId/reaction', authenticate, reactToMessage);
router.delete('/:messageId/reaction', authenticate, removeReactionFromMessage);

export default router;
