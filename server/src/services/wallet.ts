import type { PoolClient } from 'pg';
import { AppError } from '../errors.js';

export type Currency = 'gold' | 'gems' | 'xp';
export type SpendableCurrency = Exclude<Currency, 'xp'>;

const walletColumns: Record<Currency, 'balance' | 'gems_balance' | 'xp_balance'> = {
  gold: 'balance',
  gems: 'gems_balance',
  xp: 'xp_balance'
};

export async function lockWallet(client: PoolClient, userId: string): Promise<{
  gold: bigint;
  gems: bigint;
  xp: bigint;
}> {
  const result = await client.query<{
    balance: string;
    gems_balance: string;
    xp_balance: string;
  }>(
    'SELECT balance, gems_balance, xp_balance FROM wallets WHERE user_id = $1 FOR UPDATE',
    [userId]
  );
  const wallet = result.rows[0];
  if (!wallet) throw new AppError('Carteira não encontrada.', 404);
  return {
    gold: BigInt(wallet.balance),
    gems: BigInt(wallet.gems_balance),
    xp: BigInt(wallet.xp_balance)
  };
}

export async function setWalletBalance(
  client: PoolClient,
  userId: string,
  currency: Currency,
  balance: bigint
): Promise<void> {
  if (balance < 0n) throw new AppError('O saldo não pode ficar negativo.', 409);
  const column = walletColumns[currency];
  const result = await client.query(
    `UPDATE wallets SET ${column} = $2, updated_at = now() WHERE user_id = $1`,
    [userId, balance.toString()]
  );
  if (result.rowCount !== 1) throw new AppError('Carteira não encontrada.', 404);
}

export async function insertWalletTransaction(
  client: PoolClient,
  values: {
    userId: string;
    type: string;
    currency: Currency;
    amount: bigint;
    balanceAfter: bigint;
    referenceType?: string;
    referenceId?: string;
  }
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO wallet_transactions
       (user_id, type, currency, amount, balance_after, reference_type, reference_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      values.userId,
      values.type,
      values.currency,
      values.amount.toString(),
      values.balanceAfter.toString(),
      values.referenceType ?? null,
      values.referenceId ?? null
    ]
  );
  return result.rows[0]!.id;
}

export function levelForXp(xp: bigint, xpPerLevel: number): number {
  if (!Number.isSafeInteger(xpPerLevel) || xpPerLevel <= 0) {
    throw new AppError('A configuração de XP por nível está inválida.', 503);
  }
  const level = xp / BigInt(xpPerLevel) + 1n;
  return Number(level > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : level);
}
