const decimalScale = 1_000_000_000_000_000_000n;
const integerFormatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

export function formatOdds(
  numerator: string | null | undefined,
  denominator: string | null | undefined,
  fallbackChance: number
): { fraction: string; percent: string } {
  if (!numerator || !denominator) {
    return {
      fraction: '—',
      percent: `${(fallbackChance * 100).toLocaleString('pt-BR', { maximumSignificantDigits: 12 })}%`
    };
  }

  const top = BigInt(numerator);
  const bottom = BigInt(denominator);
  if (top < 0n || bottom <= 0n) throw new RangeError('Probability ratio is invalid.');

  const scaledPercent = (top * 100n * decimalScale) / bottom;
  const wholePercent = scaledPercent / decimalScale;
  const fractionalPercent = (scaledPercent % decimalScale)
    .toString()
    .padStart(18, '0')
    .replace(/0+$/, '');
  const percent = `${integerFormatter.format(wholePercent)}${fractionalPercent ? `,${fractionalPercent}` : ''}%`;

  return {
    fraction: `${integerFormatter.format(top)}/${integerFormatter.format(bottom)}`,
    percent
  };
}
