import { randomBytes, randomInt } from 'node:crypto';
import type { EffectiveCard, RarityCardSelection } from './probabilities.js';

const randomIntLimit = 1n << 48n;

function randomBigIntBelow(limit: bigint): bigint {
  if (limit <= 0n) throw new RangeError('Random limit must be positive.');
  if (limit < randomIntLimit) return BigInt(randomInt(Number(limit)));

  const bitLength = limit.toString(2).length;
  const byteLength = Math.ceil(bitLength / 8);
  const mask = (1n << BigInt(bitLength)) - 1n;
  let value: bigint;
  do {
    value = BigInt(`0x${randomBytes(byteLength).toString('hex')}`) & mask;
  } while (value >= limit);
  return value;
}

export function weightedPick<T>(items: T[], getWeight: (item: T) => bigint): T {
  const total = items.reduce((sum, item) => sum + getWeight(item), 0n);
  if (total <= 0n) throw new RangeError('Eligible entries must have positive integer weights.');

  const chosen = randomBigIntBelow(total);
  let cumulative = 0n;
  for (const item of items) {
    cumulative += getWeight(item);
    if (chosen < cumulative) return item;
  }
  throw new Error('Weighted selection did not match a candidate.');
}

export function chooseCard(
  cards: EffectiveCard[],
  mode: 'individual' | 'rarity',
  cardSelection: RarityCardSelection
): EffectiveCard {
  if (cards.length === 0) throw new RangeError('Cannot choose from an empty card pool.');
  if (mode === 'individual') {
    return weightedPick(cards, (card) => BigInt(card.card_weight));
  }

  const byRarity = new Map<string, EffectiveCard[]>();
  for (const card of cards) {
    const list = byRarity.get(card.rarity_id) ?? [];
    list.push(card);
    byRarity.set(card.rarity_id, list);
  }
  const rarities = [...byRarity.values()];
  const selectedRarity = weightedPick(rarities, (group) => BigInt(group[0]!.rarity_weight));
  return weightedPick(
    selectedRarity,
    cardSelection === 'equal' ? () => 1n : (card) => BigInt(card.card_weight)
  );
}
