import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { getPresence } from '../controllers/presenceController';

const router = Router();

router.use(authenticate);
router.get('/:userId', getPresence);

export default router;
