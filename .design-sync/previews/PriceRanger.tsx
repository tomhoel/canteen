import { PriceRanger } from "canteen";

/*
  A single-thumb max-price filter built on a native <input type="range">, so it
  keeps the platform's keyboard and screen-reader behaviour. The stories sweep
  the value because that is the only axis it has.
*/

const noop = () => {};
const frame = (children: React.ReactNode) => (
  <div style={{ width: 320, padding: 16 }}>{children}</div>
);

/** Mid-range, on the default 0-300 kr scale. */
export const Default = () => frame(<PriceRanger value={150} onChange={noop} />);

/** At the floor — the filter is at its most restrictive. */
export const AtMinimum = () => frame(<PriceRanger value={0} onChange={noop} />);

/** At the ceiling, where the filter effectively lets everything through. */
export const AtMaximum = () => frame(<PriceRanger value={300} onChange={noop} />);

/** A narrower scale with a coarser step, for a cheaper set of goods. */
export const CustomRange = () =>
  frame(<PriceRanger min={20} max={120} step={5} value={65} onChange={noop} />);
