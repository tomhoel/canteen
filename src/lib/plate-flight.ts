/** Fast start, long gentle landing: the curve the plate flies on. */
const GLIDE_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

/**
 * The plate that travels between a card and the plate view.
 *
 * The plate view is a portal over the page, and its panel clips its contents,
 * so the plate cannot grow out of the card by animating the element that ends
 * up in the panel: it would be cut off at the panel's edge for most of the
 * trip. A fixed-position copy of the picture, laid out at its destination and
 * transformed back to where it starts, flies on top of everything instead
 * (FLIP), and the real elements at either end are hidden only for the flight.
 * Transform only, so it costs one composited layer for ~300ms.
 */

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

/**
 * Fly `src` from `from` to `to` over `ms`, then call `landed` with the ghost
 * still on screen; the caller removes it once whatever replaces it is ready.
 */
export function flyPlate(
  src: string,
  from: DOMRect,
  to: DOMRect,
  ms: number,
  landed: (ghost: HTMLImageElement) => void
): HTMLImageElement {
  const ghost = document.createElement("img");
  ghost.src = src;
  ghost.alt = "";
  ghost.setAttribute("aria-hidden", "true");
  ghost.className = "plate-ghost";
  Object.assign(ghost.style, {
    left: `${to.left}px`,
    top: `${to.top}px`,
    width: `${to.width}px`,
    height: `${to.height}px`,
    transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`,
  });
  document.body.appendChild(ghost);
  void ghost.offsetWidth;
  ghost.style.transition = `transform ${ms}ms ${GLIDE_EASE}`;
  ghost.style.transform = "none";

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(backstop);
    landed(ghost);
  };
  ghost.addEventListener("transitionend", finish, { once: true });
  const backstop = setTimeout(finish, ms + 80);
  return ghost;
}
