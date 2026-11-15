export function currencyLabel(currency: string, amount?: number): string {
  if (currency === 'gold') return amount === 1 ? 'Moeda' : 'Moedas';
  if (currency === 'gems') return amount === 1 ? 'Gema' : 'Gemas';
  return currency === 'xp' ? 'XP' : currency;
}

export function localizeCurrencyText(value: string): string {
  return value.replace(/\bGold\b/g, 'Moedas').replace(/\bGems\b/g, 'Gemas').replace(/\bGem\b/g, 'Gema');
}
