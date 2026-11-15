import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateEffectiveCards, type EligibleCard } from './distribution.js';
import { calculateInvocationOdds, calculatePityProbability, toNumber } from './invocation.js';
import { parseYouTubeVideoId } from './youtube.js';
import { assertDuplicateRewardPolicy } from './invocation-config.js';

function card(
  id: string,
  weight: string,
  rarityId: string,
  rarityWeight: string,
  raritySortOrder: number
): EligibleCard {
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
    rarity_sort_order: raritySortOrder,
    card_weight: weight,
    rarity_weight: rarityWeight,
    active: true,
    rarity_active: true
  };
}

test('soft pity begins on the configured position and hard pity guarantees at H', () => {
  const base = { numerator: 1n, denominator: 100n };
  const rule = { softPityStart: 3, softPityIncrementBps: 100, hardPityLimit: 5 };
  assert.equal(toNumber(calculatePityProbability(base, 2, rule)), 0.01);
  assert.equal(toNumber(calculatePityProbability(base, 3, rule)), 0.02);
  assert.equal(toNumber(calculatePityProbability(base, 4, rule)), 0.03);
  assert.equal(toNumber(calculatePityProbability(base, 5, rule)), 1);
});

test('hard pity is not granted before its configured position', () => {
  const base = { numerator: 1n, denominator: 100n };
  const rule = { softPityStart: null, softPityIncrementBps: 0, hardPityLimit: 5 };
  assert.equal(toNumber(calculatePityProbability(base, 4, rule)), 0.01);
  assert.equal(toNumber(calculatePityProbability(base, 5, rule)), 1);
});

test('pity preserves relative odds within each rarity group', () => {
  const cards = calculateEffectiveCards([
    card('low', '6', 'common', '1', 1),
    card('high-a', '1', 'epic', '1', 4),
    card('high-b', '3', 'epic', '1', 4)
  ], 'individual', 'equal');
  const odds = calculateInvocationOdds(cards, 'individual', 'equal', 1, {
    targetSortOrder: 4,
    softPityStart: 1,
    softPityIncrementBps: 1000,
    hardPityLimit: 10
  });
  assert.equal(toNumber(odds.targetChance), 0.5);
  assert.equal(toNumber(odds.cardChances.get('high-a')!), 0.125);
  assert.equal(toNumber(odds.cardChances.get('high-b')!), 0.375);
  assert.equal(toNumber(odds.cardChances.get('low')!), 0.5);
});

test('rarity-mode pity honors its configured equal-card selection', () => {
  const cards = calculateEffectiveCards([
    card('common-a', '1', 'common', '9', 1),
    card('common-b', '5', 'common', '9', 1),
    card('epic-a', '1', 'epic', '1', 4),
    card('epic-b', '9', 'epic', '1', 4)
  ], 'rarity', 'equal');
  const odds = calculateInvocationOdds(cards, 'rarity', 'equal', 1, {
    targetSortOrder: 4,
    softPityStart: 1,
    softPityIncrementBps: 2500,
    hardPityLimit: null
  });
  assert.equal(toNumber(odds.targetChance), 0.35);
  assert.equal(toNumber(odds.cardChances.get('epic-a')!), 0.175);
  assert.equal(toNumber(odds.cardChances.get('epic-b')!), 0.175);
  assert.equal(toNumber(odds.cardChances.get('common-a')!), 0.325);
  assert.equal(toNumber(odds.cardChances.get('common-b')!), 0.325);
});

test('pity reports an impossible target instead of inventing a card', () => {
  const cards = calculateEffectiveCards([card('common', '1', 'common', '1', 1)], 'individual', 'equal');
  const odds = calculateInvocationOdds(cards, 'individual', 'equal', 1, {
    targetSortOrder: 4,
    softPityStart: 1,
    softPityIncrementBps: 100,
    hardPityLimit: 10
  });
  assert.equal(odds.impossible, true);
  assert.equal(odds.cardChances.size, 0);
});

test('YouTube URLs accept only supported HTTPS video formats', () => {
  assert.equal(parseYouTubeVideoId('https://www.youtube.com/watch?v=Abcdef_1234'), 'Abcdef_1234');
  assert.equal(parseYouTubeVideoId('https://youtu.be/Abcdef_1234'), 'Abcdef_1234');
  assert.equal(parseYouTubeVideoId('https://youtube.com/shorts/Abcdef_1234'), 'Abcdef_1234');
  assert.equal(parseYouTubeVideoId('https://youtube.com/live/Abcdef_1234'), 'Abcdef_1234');
  assert.equal(parseYouTubeVideoId('https://youtube.com/embed/Abcdef_1234'), 'Abcdef_1234');
  assert.throws(() => parseYouTubeVideoId('http://youtu.be/Abcdef_1234'), /HTTPS/);
  assert.throws(() => parseYouTubeVideoId('https://youtube.com.attacker.test/watch?v=Abcdef_1234'), /domínio oficial/);
  assert.throws(() => parseYouTubeVideoId('https://youtube.com/watch?v=invalid'), /identificador/);
  assert.throws(() => parseYouTubeVideoId('https://youtube.com/watch?v=Abcdef_1234&v=Abcdef_1234'), /identificador/);
});

test('duplicate conversions allow only the rewards assigned to each rarity tier', () => {
  for (const tier of ['common', 'uncommon', 'rare']) {
    assert.doesNotThrow(() => assertDuplicateRewardPolicy(tier, 10n, 0n, 5n));
    assert.throws(() => assertDuplicateRewardPolicy(tier, 10n, 1n, 5n), /Somente duplicatas/);
  }
  for (const tier of ['epic', 'legendary', 'secret']) {
    assert.doesNotThrow(() => assertDuplicateRewardPolicy(tier, 10n, 1n, 5n));
    assert.throws(() => assertDuplicateRewardPolicy(tier, 10n, 0n, 5n), /precisam conceder gemas/);
  }
  assert.throws(() => assertDuplicateRewardPolicy('common', 0n, 0n, 5n), /moedas e XP/);
  assert.throws(() => assertDuplicateRewardPolicy('epic', 10n, 1n, 0n), /moedas e XP/);
  assert.throws(() => assertDuplicateRewardPolicy(null, 10n, 0n, 5n), /Classifique a raridade/);
});
