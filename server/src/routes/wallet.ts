import { Router } from 'express';
import { pool } from '../db/pool.js';
import { AppError } from '../errors.js';
import { requireAuth } from '../http/auth.js';
import { asyncHandler } from '../http/async-handler.js';

const router = Router();
router.use(requireAuth);

router.get('/', asyncHandler(async (request, response) => {
  const result = await pool.query<{
    balance: string;
    gems_balance: string;
    xp_balance: string;
    last_daily_claim_at: Date | null;
  }>(
    'SELECT balance, gems_balance, xp_balance, last_daily_claim_at FROM wallets WHERE user_id = $1',
    [request.user!.id]
  );
  const wallet = result.rows[0];
  if (!wallet) throw new AppError('Carteira não encontrada.', 404);
  response.json({
    balance: Number(wallet.balance),
    gold: Number(wallet.balance),
    gems: Number(wallet.gems_balance),
    xp: Number(wallet.xp_balance),
    lastDailyClaimAt: wallet.last_daily_claim_at
  });
}));

router.get('/transactions', asyncHandler(async (request, response) => {
  const result = await pool.query<{
    id: string;
    type: string;
    currency: string;
    amount: string;
    balance_after: string;
    created_at: Date;
  }>(
    `SELECT id, type, currency, amount, balance_after, created_at
     FROM wallet_transactions
     WHERE user_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT 100`,
    [request.user!.id]
  );
  response.json({
    transactions: result.rows.map((row) => ({
      id: row.id,
      type: row.type,
      currency: row.currency,
      amount: Number(row.amount),
      balanceAfter: Number(row.balance_after),
      createdAt: row.created_at
    }))
  });
}));

export default router;
