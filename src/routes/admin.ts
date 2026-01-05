import express from 'express';
import { authMiddleware, requirePermission } from '../middleware/auth';

const router = express.Router();

router.use(authMiddleware);
router.use(requirePermission('manage_users'));

router.get('/', (_req, res) => {
  res.json({ message: 'admin endpoint placeholder' });
});

export default router;
