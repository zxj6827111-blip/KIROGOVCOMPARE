import express from 'express';

const router = express.Router();

router.get('/', (_req, res) => {
  res.json({ message: 'catalog endpoint placeholder' });
});

export default router;
