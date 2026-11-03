/** Where the plate view finds the card plate it grows out of and lands back on. */

/** The plate image of `canteen` on the day on screen, if it is visible. */
export function cardPlate(canteen: string): HTMLElement | null {
  const circle = document.querySelector<HTMLElement>(
    `.day-panel:not([inert]) [data-plate="${CSS.escape(canteen)}"]`
  );
  if (!circle) return null;
  const r = circle.getBoundingClientRect();
  const onScreen = r.width > 0 && r.bottom > 0 && r.top < window.innerHeight;
  return onScreen ? (circle.querySelector<HTMLElement>(".food-image") ?? circle) : null;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
