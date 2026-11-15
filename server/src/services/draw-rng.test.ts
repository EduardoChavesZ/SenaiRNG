import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateCardProbabilities, calculateEffectiveCards, type EligibleCard } from './distribution.js';
import { chooseCard } from './draw-rng.js';

function card(id: string, weight: string, rarityId = 'common'): EligibleCard {
  return {
    id,
    name: id,
    image_path: null,
    description: '',
    category_id: null,
    category_name: null,
    rarity_id: rarityId,
    rarity_name: rarityId,
    rarity_color_primary: '#ffffff',
    rarity_color_secondary: '#000000',
    rarity_animation_level: 1,
    rarity_sort_order: 0,
    card_weight: weight,
    rarity_weight: rarityId === 'rare' ? '1' : '9',
    active: true,
    rarity_active: true
  };
}

test('all active cards remain eligible without inventory limits', () => {
  const cards = calculateEffectiveCards(
    [card('one-in-ten', '1'), card('nine-in-ten', '9')],
    'individual',
    'equal'
  );
  assert.equal(cards.length, 2);
  assert.equal(cards[0]!.effectiveCardChance, 0.1);
  assert.equal(cards[1]!.effectiveCardChance, 0.9);
});

test('disabled cards retain nominal chance but are excluded from effective probabilities', () => {
  const probabilities = calculateCardProbabilities([
    card('active', '1'),
    { ...card('disabled', '1'), active: false }
  ], 'individual', 'equal');
  const disabled = probabilities.find((item) => item.id === 'disabled')!;
  assert.equal(disabled.nominalCardChance, 0.5);
  assert.equal(disabled.effectiveCardChance, 0);
  assert.equal(disabled.available, false);
});

test('100,000 secure weighted draws stay within a six-sigma tolerance', () => {
  const distribution = calculateEffectiveCards(
    [card('one-in-ten', '1'), card('nine-in-ten', '9')],
    'individual',
    'equal'
  );
  const expected = distribution.find((item) => item.id === 'one-in-ten')!.effectiveCardChance;
  const sampleSize = 100_000;
  let observed = 0;
  for (let index = 0; index < sampleSize; index += 1) {
    if (chooseCard(distribution, 'individual', 'equal').id === 'one-in-ten') observed += 1;
  }
  const actual = observed / sampleSize;
  const tolerance = 6 * Math.sqrt(expected * (1 - expected) / sampleSize);
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${expected}, observed ${actual}, tolerance ${tolerance}`);
});

test('rarity mode applies rarity weights and equal selection within a rarity', () => {
  const distribution = calculateEffectiveCards([
    card('common-a', '1', 'common'),
    card('common-b', '3', 'common'),
    card('rare-a', '1', 'rare')
  ], 'rarity', 'equal');
  const commonCards = distribution.filter((item) => item.rarity_id === 'common');
  const rareCard = distribution.find((item) => item.rarity_id === 'rare');
  assert.equal(commonCards[0]!.effectiveRarityChance, 0.9);
  assert.equal(commonCards[0]!.effectiveCardChance, 0.45);
  assert.equal(commonCards[1]!.effectiveCardChance, 0.45);
  assert.equal(rareCard!.effectiveCardChance, 0.1);
});
