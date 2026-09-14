/**
 * Shared in-memory image cache tracking which dish plates have loaded.
 * Allows FoodCard and ClosedCard to immediately render with opacity: 1 and
 * skip shimmers when switching between previously visited or preloaded days.
 */
export const loadedImageUrls = new Set<string>();

export function markImageCached(src?: string | null): void {
  if (src) loadedImageUrls.add(src);
}
