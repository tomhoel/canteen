interface PriceRangerProps {
  min?: number;
  max?: number;
  value: number;
  onChange: (val: number) => void;
  step?: number;
}

/**
 * Single-thumb max-price filter.
 *
 * Uses a native <input type="range"> rather than a JS slider library: it is one
 * value on one track, so the platform control already does the job — and it
 * comes with keyboard support, focus handling and screen-reader semantics that
 * the previous mousedown-only implementation lacked entirely.
 */
export function PriceRanger({
  min = 0,
  max = 300,
  value,
  onChange,
  step = 5,
}: PriceRangerProps) {
  // Percentage filled, used to paint the track up to the thumb.
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const label = value >= max ? "Alle priser" : `Inntil ${value} kr`;

  return (
    <div className="price-ranger">
      <div className="price-ranger-row">
        <label htmlFor="price-ranger-input">Makspris filter:</label>
        <span className="price-ranger-value">{label}</span>
      </div>

      <input
        id="price-ranger-input"
        className="price-ranger-input"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-valuetext={label}
        style={{ ["--price-ranger-pct" as string]: `${pct}%` }}
      />
    </div>
  );
}
