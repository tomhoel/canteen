/**
 * Where the day board stands, for the day dock.
 *
 * The board is a native scroller and its highlight in the dock has to follow
 * it frame by frame. A tiny broadcast does that without threading a callback
 * through HomeClient or re-rendering anything: useDayScroller emits from the
 * scroll position, DaySelector writes the pill's transform.
 */
export type DayProgress = {
  /** The day at or before the board's position. */
  from: number;
  /** 0..1: how far from `from` toward the next day the board has got. */
  progress: number;
} | null;

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
