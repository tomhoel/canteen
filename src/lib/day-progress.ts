/**
 * Where a day change in progress stands, for the day dock.
 *
 * The drag writes the track's transform directly on every touchmove, without a
 * React render, and the dock's highlight has to keep up with it at the same
 * rate. A tiny broadcast does that without threading a callback through
 * HomeClient or re-rendering anything: useDaySwipe emits, DaySelector writes the
 * pill's transform. `settle` glides the pill with the board when it is let go;
 * `null` means nothing is moving.
 */
export type DayProgress =
  | {
      /** The day the drag started from. */
      from: number;
      /** -1..1: how far toward the previous (negative) or next day it has got. */
      progress: number;
    }
  | {
      /** The board was let go and is gliding to this day... */
      settle: number;
      /** ...over this long, on the same curve as the board. */
      ms: number;
    }
  | null;

type Listener = (p: DayProgress) => void;
const listeners = new Set<Listener>();

export function emitDayProgress(p: DayProgress): void {
  listeners.forEach((l) => l(p));
}

export function onDayProgress(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
