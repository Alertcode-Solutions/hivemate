import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getPushPublicKey,
  subscribePush,
  unsubscribePush,
  subscribeMobilePushToken,
  unsubscribeMobilePushToken
} from '../controllers/pushController';

const router = Router();

router.get('/public-key', getPushPublicKey);
router.post('/subscribe', authenticate, subscribePush);
router.post('/unsubscribe', authenticate, unsubscribePush);
router.post('/mobile-token', authenticate, subscribeMobilePushToken);
router.post('/mobile-token/unsubscribe', authenticate, unsubscribeMobilePushToken);

export default router;
