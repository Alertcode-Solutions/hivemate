import { Router } from 'express';
import {
  initiateCall,
  endCall,
  getCallStatus,
  getCommunicationLevel
} from '../controllers/callController';
import { authenticate } from '../middleware/auth';

const router = Router();

// All call routes require authentication
router.post('/initiate', authenticate, initiateCall);
router.put('/:callId/end', authenticate, endCall);
router.get('/:callId/status', authenticate, getCallStatus);
router.get('/level/:friendId', authenticate, getCommunicationLevel);
router.get('/capabilities/:friendId', authenticate, getCommunicationLevel);

export default router;
