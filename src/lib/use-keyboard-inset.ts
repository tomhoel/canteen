import { useEffect, useState } from "react";

type VirtualKeyboardLike = EventTarget & {
  overlaysContent: boolean;
  boundingRect: { height: number };
};

/**
 * Returns the height in px that the on-screen (soft) keyboard currently covers at
 * the bottom of the layout viewport — 0 when no keyboard is up.
 * Supports iOS Safari (visualViewport) and Android Chrome (navigator.virtualKeyboard).
 */
export function useKeyboardInset(enabled: boolean): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      setInset(0);
      return;
    }
    const vv = window.visualViewport;
    const vk = (navigator as Navigator & { virtualKeyboard?: VirtualKeyboardLike })
      .virtualKeyboard;
    if (!vv && !vk) return;

    const prevOverlays = vk?.overlaysContent;
    if (vk) vk.overlaysContent = true;

    let raf = 0;
    const compute = () => {
      let covered = 0;
      if (vk?.overlaysContent) {
        covered = vk.boundingRect.height;
      } else if (vv) {
        covered = window.innerHeight - (vv.height + vv.offsetTop);
      }
      const next = covered > 100 ? Math.round(covered) : 0;
      setInset((prev) => (prev === next ? prev : next));
    };

    const onChange = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(compute);
    };

    compute();
    vv?.addEventListener("resize", onChange);
    vv?.addEventListener("scroll", onChange);
    vk?.addEventListener("geometrychange", onChange);
    return () => {
      cancelAnimationFrame(raf);
      vv?.removeEventListener("resize", onChange);
      vv?.removeEventListener("scroll", onChange);
      vk?.removeEventListener("geometrychange", onChange);
      if (vk) vk.overlaysContent = prevOverlays ?? false;
      setInset(0);
    };
  }, [enabled]);

  return inset;
}
