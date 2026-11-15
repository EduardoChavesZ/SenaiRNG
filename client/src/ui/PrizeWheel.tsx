import { formatOdds } from '../odds';

export const wheelPalette = ['#7456D8', '#E56A66', '#E7AE4F', '#299C8E', '#527FD6', '#BC5E9D', '#D8754A'] as const;

export interface WheelSegment {
  id: string;
  name: string;
  effectiveCardChance: number;
  effectiveCardNumerator?: string;
  effectiveCardDenominator?: string;
  colorPrimary?: string;
  colorSecondary?: string;
}

export function wheelColor(index: number): string {
  return wheelPalette[index % wheelPalette.length];
}

export function getWheelTargetRotation(
  currentRotation: number,
  segments: WheelSegment[],
  selectedId: string
): number {
  const totalChance = segments.reduce((total, segment) => total + segment.effectiveCardChance, 0);
  if (totalChance <= 0) return currentRotation;
  const selectedIndex = segments.findIndex((segment) => segment.id === selectedId);
  if (selectedIndex < 0) return currentRotation;
  const selected = segments[selectedIndex]!;
  const chanceBefore = segments
    .slice(0, selectedIndex)
    .reduce((total, segment) => total + segment.effectiveCardChance, 0);
  const centerAngle = ((chanceBefore + selected.effectiveCardChance / 2) / totalChance) * 360;
  const currentOffset = ((currentRotation % 360) + 360) % 360;
  const targetOffset = (360 - centerAngle) % 360;
  const alignment = (targetOffset - currentOffset + 360) % 360;
  return currentRotation + 4 * 360 + alignment;
}

export function PrizeWheel({
  segments,
  rotation,
  duration,
  spinning,
  disabled,
  onSpin,
  ariaLabel = `Roleta com ${segments.length} fatias`,
  buttonLabel = 'Girar a roleta',
  centerLabel = 'GIRAR'
}: {
  segments: WheelSegment[];
  rotation: number;
  duration: number;
  spinning: boolean;
  disabled: boolean;
  onSpin: () => void;
  ariaLabel?: string;
  buttonLabel?: string;
  centerLabel?: string;
}) {
  const totalChance = segments.reduce((total, segment) => total + segment.effectiveCardChance, 0);
  let startAngle = 0;
  const slices = segments.map((segment, index) => {
    const sweep = totalChance > 0 ? (segment.effectiveCardChance / totalChance) * 360 : 0;
    const slice = { segment, index, startAngle, endAngle: startAngle + sweep };
    startAngle += sweep;
    return slice;
  });

  return (
    <div className="prize-wheel-wrap">
      <span className="wheel-pointer" aria-hidden="true" />
      <svg
        className="prize-wheel"
        viewBox="0 0 220 220"
        role="img"
        aria-label={ariaLabel}
        style={{ transform: `rotate(${rotation}deg)`, transitionDuration: `${duration}ms` }}
      >
        <g>
          {segments.length === 1 && <circle cx="110" cy="110" r="104" fill={segments[0]!.colorPrimary ?? wheelColor(0)} />}
          {segments.length > 1 && slices.map(({ segment, index, startAngle: start, endAngle: end }) => {
            const startPoint = pointOnWheel(start);
            const endPoint = pointOnWheel(end);
            const largeArc = end - start > 180 ? 1 : 0;
            const path = `M 110 110 L ${startPoint.x} ${startPoint.y} A 104 104 0 ${largeArc} 1 ${endPoint.x} ${endPoint.y} Z`;
            return (
              <path key={segment.id} d={path} fill={segment.colorPrimary ?? wheelColor(index)} stroke={segment.colorSecondary ?? '#FFFFFFB8'} strokeWidth="1.5">
                <title>{segment.name}: {formatOdds(segment.effectiveCardNumerator, segment.effectiveCardDenominator, segment.effectiveCardChance).percent}</title>
              </path>
            );
          })}
          {segments.length > 1 && slices.filter(({ endAngle, startAngle }) => endAngle - startAngle >= 28).map(({ segment, startAngle, endAngle }) => {
            const midpoint = (startAngle + endAngle) / 2;
            const labelPoint = pointOnWheel(midpoint, 66);
            const readableAngle = midpoint > 90 && midpoint < 270 ? midpoint + 180 : midpoint;
            const label = segment.name.length > 13 ? `${segment.name.slice(0, 12)}…` : segment.name;
            return (
              <text
                key={`${segment.id}-label`}
                x={labelPoint.x}
                y={labelPoint.y}
                transform={`rotate(${readableAngle} ${labelPoint.x} ${labelPoint.y})`}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#292434"
                stroke="#FFFFFF"
                strokeWidth="2.5"
                paintOrder="stroke"
                fontSize={segments.length > 8 ? 5 : segments.length > 5 ? 6 : 8}
                fontWeight="700"
                letterSpacing=".15"
                pointerEvents="none"
              >
                {label}
              </text>
            );
          })}
          {segments.length === 0 && <circle cx="110" cy="110" r="104" fill="#F2F2F2" />}
          <circle cx="110" cy="110" r="104" fill="none" stroke="#FFFFFF" strokeWidth="5" />
          <circle cx="110" cy="110" r="100" fill="none" stroke="#E5DFEB" strokeWidth="1.5" />
        </g>
      </svg>
      <button
        className="wheel-center-button"
        type="button"
        aria-label={buttonLabel}
        aria-busy={spinning}
        disabled={disabled}
        onClick={onSpin}
      >
        {spinning ? 'AGUARDE' : centerLabel}
      </button>
    </div>
  );
}

function pointOnWheel(degrees: number, radius = 104): { x: number; y: number } {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return {
    x: 110 + radius * Math.cos(radians),
    y: 110 + radius * Math.sin(radians)
  };
}
