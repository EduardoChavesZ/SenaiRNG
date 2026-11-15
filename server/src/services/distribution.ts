export type DistributionMode = 'individual' | 'rarity';
export type RarityCardSelection = 'equal' | 'weighted';

export interface EligibleCard {
  id: string;
  name: string;
  image_path: string | null;
  description: string;
  category_id: string | null;
  category_name: string | null;
  rarity_id: string;
  rarity_name: string;
  rarity_color_primary: string;
  rarity_color_secondary: string;
  rarity_animation_level: number;
  rarity_sort_order: number;
  card_weight: string;
  rarity_weight: string;
  active: boolean;
  rarity_active: boolean;
}

export interface EffectiveCard extends EligibleCard {
  nominalCardChance: number;
  nominalRarityChance: number;
  effectiveCardChance: number;
  effectiveRarityChance: number;
  nominalCardNumerator: string;
  nominalCardDenominator: string;
  nominalRarityNumerator: string;
  nominalRarityDenominator: string;
  effectiveCardNumerator: string;
  effectiveCardDenominator: string;
  effectiveRarityNumerator: string;
  effectiveRarityDenominator: string;
  nominalRarityWeight: number | null;
}

export interface ProbabilityCard extends EffectiveCard {
  available: boolean;
}

export function calculateCardProbabilities(
  allCards: EligibleCard[],
  mode: DistributionMode,
  innerSelection: RarityCardSelection
): ProbabilityCard[] {
  const cards = allCards.filter((card) =>
    card.active && card.rarity_active
  );
  const cardWeight = (card: EligibleCard) => BigInt(card.card_weight);
  const rarityWeight = (card: EligibleCard) => BigInt(card.rarity_weight);
  const ratio = (numerator: bigint, denominator: bigint) => {
    if (numerator === 0n || denominator === 0n) return { numerator: 0n, denominator: 1n };
    const divisor = greatestCommonDivisor(numerator, denominator);
    return { numerator: numerator / divisor, denominator: denominator / divisor };
  };
  const asChance = (value: { numerator: bigint; denominator: bigint }) =>
    Number(value.numerator) / Number(value.denominator);
  const nominalTotalCardWeight = allCards.reduce((sum, card) => sum + cardWeight(card), 0n);
  const totalCardWeight = cards.reduce((sum, card) => sum + cardWeight(card), 0n);
  const nominalRarityCards = new Map<string, EligibleCard[]>();
  const rarityCards = new Map<string, EligibleCard[]>();
  for (const card of allCards) {
    const list = nominalRarityCards.get(card.rarity_id) ?? [];
    list.push(card);
    nominalRarityCards.set(card.rarity_id, list);
  }
  for (const card of cards) {
    const list = rarityCards.get(card.rarity_id) ?? [];
    list.push(card);
    rarityCards.set(card.rarity_id, list);
  }
  const nominalRarities = [...nominalRarityCards.values()].map((rarity) => rarity[0]!);
  const nominalTotalRarityWeight = nominalRarities.reduce((sum, rarity) => sum + rarityWeight(rarity), 0n);
  const activeRarities = [...rarityCards.values()].map((rarity) => rarity[0]!);
  const totalRarityWeight = activeRarities.reduce((sum, rarity) => sum + rarityWeight(rarity), 0n);
  const availableById = new Map<string, {
    effectiveCardChance: number;
    effectiveRarityChance: number;
    effectiveCardNumerator: string;
    effectiveCardDenominator: string;
    effectiveRarityNumerator: string;
    effectiveRarityDenominator: string;
  }>();

  for (const card of cards) {
    const rarityGroup = rarityCards.get(card.rarity_id)!;
    const groupCardWeight = rarityGroup.reduce((sum, entry) => sum + cardWeight(entry), 0n);
    const effectiveCardRatio = mode === 'individual'
      ? ratio(cardWeight(card), totalCardWeight)
      : innerSelection === 'equal'
        ? ratio(rarityWeight(card), totalRarityWeight * BigInt(rarityGroup.length))
        : ratio(rarityWeight(card) * cardWeight(card), totalRarityWeight * groupCardWeight);
    const effectiveRarityRatio = mode === 'individual'
      ? ratio(groupCardWeight, totalCardWeight)
      : ratio(rarityWeight(card), totalRarityWeight);

    availableById.set(card.id, {
      effectiveCardChance: asChance(effectiveCardRatio),
      effectiveRarityChance: asChance(effectiveRarityRatio),
      effectiveCardNumerator: effectiveCardRatio.numerator.toString(),
      effectiveCardDenominator: effectiveCardRatio.denominator.toString(),
      effectiveRarityNumerator: effectiveRarityRatio.numerator.toString(),
      effectiveRarityDenominator: effectiveRarityRatio.denominator.toString()
    });
  }

  return allCards.map((card) => {
    const nominalRarityGroup = nominalRarityCards.get(card.rarity_id) ?? [];
    const nominalGroupCardWeight = nominalRarityGroup.reduce((sum, entry) => sum + cardWeight(entry), 0n);
    const nominalCardRatio = mode === 'individual'
      ? ratio(cardWeight(card), nominalTotalCardWeight)
      : innerSelection === 'equal'
        ? ratio(rarityWeight(card), nominalTotalRarityWeight * BigInt(nominalRarityGroup.length))
        : ratio(rarityWeight(card) * cardWeight(card), nominalTotalRarityWeight * nominalGroupCardWeight);
    const nominalRarityRatio = mode === 'individual'
      ? ratio(nominalGroupCardWeight, nominalTotalCardWeight)
      : ratio(rarityWeight(card), nominalTotalRarityWeight);
    const effective = availableById.get(card.id);
    return {
      ...card,
      nominalCardChance: asChance(nominalCardRatio),
      nominalRarityChance: asChance(nominalRarityRatio),
      nominalCardNumerator: nominalCardRatio.numerator.toString(),
      nominalCardDenominator: nominalCardRatio.denominator.toString(),
      nominalRarityNumerator: nominalRarityRatio.numerator.toString(),
      nominalRarityDenominator: nominalRarityRatio.denominator.toString(),
      effectiveCardChance: effective?.effectiveCardChance ?? 0,
      effectiveRarityChance: effective?.effectiveRarityChance ?? 0,
      effectiveCardNumerator: effective?.effectiveCardNumerator ?? '0',
      effectiveCardDenominator: effective?.effectiveCardDenominator ?? '1',
      effectiveRarityNumerator: effective?.effectiveRarityNumerator ?? '0',
      effectiveRarityDenominator: effective?.effectiveRarityDenominator ?? '1',
      nominalRarityWeight: mode === 'rarity' ? Number(rarityWeight(card)) : null,
      available: Boolean(effective)
    };
  });
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a || 1n;
}

export function calculateEffectiveCards(
  allCards: EligibleCard[],
  mode: DistributionMode,
  innerSelection: RarityCardSelection
): EffectiveCard[] {
  return calculateCardProbabilities(allCards, mode, innerSelection)
    .filter((card) => card.available)
    .map(({ available: _isAvailable, ...card }) => card);
}
