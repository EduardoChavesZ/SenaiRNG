import type { EffectiveCard, RarityCardSelection } from './probabilities.js';

export type Rational = { numerator: bigint; denominator: bigint };

export type PityRule = {
  targetSortOrder: number;
  softPityStart: number | null;
  softPityIncrementBps: number;
  hardPityLimit: number | null;
};

export type InvocationOdds = {
  baseTargetChance: Rational;
  targetChance: Rational;
  cardChances: Map<string, Rational>;
  impossible: boolean;
};

export function calculatePityProbability(
  base: Rational,
  position: number,
  rule: Pick<PityRule, 'softPityStart' | 'softPityIncrementBps' | 'hardPityLimit'>
): Rational {
  if (base.denominator <= 0n || base.numerator < 0n || base.numerator > base.denominator) {
    throw new RangeError('Base probability must be between zero and one.');
  }
  if (!Number.isSafeInteger(position) || position < 1) {
    throw new RangeError('Pity position must be a positive integer.');
  }
  if (rule.hardPityLimit !== null && position >= rule.hardPityLimit) {
    return { numerator: 1n, denominator: 1n };
  }

  const increments = rule.softPityStart === null
    ? 0
    : Math.max(0, position - rule.softPityStart + 1);
  if (increments === 0 || rule.softPityIncrementBps === 0) return reduce(base);

  const numerator = base.numerator * 10_000n
    + BigInt(increments * rule.softPityIncrementBps) * base.denominator;
  const denominator = base.denominator * 10_000n;
  if (numerator >= denominator) return { numerator: 1n, denominator: 1n };
  return reduce({ numerator, denominator });
}

export function calculateInvocationOdds(
  cards: EffectiveCard[],
  mode: 'individual' | 'rarity',
  selection: RarityCardSelection,
  position: number,
  rule: PityRule | null
): InvocationOdds {
  if (cards.length === 0) throw new RangeError('Invocation pool must contain eligible cards.');
  if (!rule) {
    return {
      baseTargetChance: { numerator: 0n, denominator: 1n },
      targetChance: { numerator: 0n, denominator: 1n },
      cardChances: new Map(cards.map((card) => [
        card.id,
        reduce({
          numerator: BigInt(card.effectiveCardNumerator),
          denominator: BigInt(card.effectiveCardDenominator)
        })
      ])),
      impossible: false
    };
  }

  const targetCards = cards.filter((card) => card.rarity_sort_order >= rule.targetSortOrder);
  const lowerCards = cards.filter((card) => card.rarity_sort_order < rule.targetSortOrder);
  const baseTargetChance = groupChance(cards, targetCards, mode);
  const targetChance = calculatePityProbability(baseTargetChance, position, rule);
  const impossible = targetCards.length === 0 && targetChance.numerator > 0n;
  const cardChances = new Map<string, Rational>();

  if (impossible) {
    return { baseTargetChance, targetChance, cardChances, impossible: true };
  }

  for (const card of targetCards) {
    cardChances.set(card.id, multiply(targetChance, conditionalChance(card, targetCards, mode, selection)));
  }
  const lowerChance = subtractOne(targetChance);
  for (const card of lowerCards) {
    cardChances.set(card.id, multiply(lowerChance, conditionalChance(card, lowerCards, mode, selection)));
  }

  return { baseTargetChance, targetChance, cardChances, impossible: false };
}

export function toNumber(value: Rational): number {
  return Number(value.numerator) / Number(value.denominator);
}

export function reduce(value: Rational): Rational {
  if (value.denominator <= 0n || value.numerator < 0n) {
    throw new RangeError('Probability ratio must be non-negative with a positive denominator.');
  }
  const divisor = greatestCommonDivisor(value.numerator, value.denominator);
  return { numerator: value.numerator / divisor, denominator: value.denominator / divisor };
}

function groupChance(
  allCards: EffectiveCard[],
  groupCards: EffectiveCard[],
  mode: 'individual' | 'rarity'
): Rational {
  if (!groupCards.length) return { numerator: 0n, denominator: 1n };
  if (mode === 'individual') {
    return reduce({
      numerator: groupCards.reduce((sum, card) => sum + BigInt(card.card_weight), 0n),
      denominator: allCards.reduce((sum, card) => sum + BigInt(card.card_weight), 0n)
    });
  }
  const allRarities = new Map(allCards.map((card) => [card.rarity_id, BigInt(card.rarity_weight)]));
  const groupRarities = new Map(groupCards.map((card) => [card.rarity_id, BigInt(card.rarity_weight)]));
  return reduce({
    numerator: [...groupRarities.values()].reduce((sum, weight) => sum + weight, 0n),
    denominator: [...allRarities.values()].reduce((sum, weight) => sum + weight, 0n)
  });
}

function conditionalChance(
  selected: EffectiveCard,
  groupCards: EffectiveCard[],
  mode: 'individual' | 'rarity',
  selection: RarityCardSelection
): Rational {
  if (mode === 'individual') {
    return reduce({
      numerator: BigInt(selected.card_weight),
      denominator: groupCards.reduce((sum, card) => sum + BigInt(card.card_weight), 0n)
    });
  }

  const rarities = new Map(groupCards.map((card) => [card.rarity_id, BigInt(card.rarity_weight)]));
  const groupRarityWeight = [...rarities.values()].reduce((sum, weight) => sum + weight, 0n);
  const rarityChance = reduce({
    numerator: BigInt(selected.rarity_weight),
    denominator: groupRarityWeight
  });
  const sameRarity = groupCards.filter((card) => card.rarity_id === selected.rarity_id);
  const cardChance = selection === 'equal'
    ? { numerator: 1n, denominator: BigInt(sameRarity.length) }
    : reduce({
      numerator: BigInt(selected.card_weight),
      denominator: sameRarity.reduce((sum, card) => sum + BigInt(card.card_weight), 0n)
    });
  return multiply(rarityChance, cardChance);
}

function multiply(left: Rational, right: Rational): Rational {
  return reduce({
    numerator: left.numerator * right.numerator,
    denominator: left.denominator * right.denominator
  });
}

function subtractOne(value: Rational): Rational {
  return reduce({
    numerator: value.denominator - value.numerator,
    denominator: value.denominator
  });
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a || 1n;
}
