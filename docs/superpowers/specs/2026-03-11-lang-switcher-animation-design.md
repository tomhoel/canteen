# Language Switcher Animation — Design Spec

**Date:** 2026-03-11
**Status:** Approved

## Overview

Add polished animation to the language switcher (NO/EN toggle) and animate page content when the language changes. The goal is a tactile, satisfying feel — the button pops with spring physics, and all translatable UI text fades and shifts slightly before updating.

## Button Animation — Morph + Scale

Update `.lang-btn` and `.lang-btn.active` in `src/app/globals.css`. Current values for reference:

```css
/* CURRENT — replace these */
.lang-btn {
  border: none; background: transparent; padding: 8px 20px;
  font-size: clamp(12px, 2.5vw, 14px); font-weight: 600;
  color: var(--text-secondary); border-radius: 50px; cursor: pointer;
  transition: all 0.3s ease;   /* ← replace transition */
}
.lang-btn.active {
  background: var(--accent-orange); color: white;
  box-shadow: 0 2px 10px rgba(200, 116, 26, 0.45);  /* ← strengthen shadow */
}
```

**Active state:**
- `transform: scale(1.08)` — button grows slightly
- `box-shadow: 0 3px 16px rgba(200, 116, 26, 0.55)` — warm glow (stronger than current)
- `background: var(--accent-orange)`
- `color: white`

**Inactive state:**
- `transform: scale(1.0)` — explicit, so the transition fires both ways
- `color: var(--text-secondary)` — slightly dimmed
- No shadow

**Transition on both states:**
```css
transition: background 0.25s cubic-bezier(0.34, 1.56, 0.64, 1),
            color 0.25s ease,
            transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1),
            box-shadow 0.25s ease;
```

The spring easing (`0.34, 1.56, 0.64, 1`) gives the active button a subtle overshoot — it grows past 1.08 momentarily before settling. The inactive button slides back smoothly.

## Content Transition — Transition-State Delay

### State

Add to `page.tsx`:

```tsx
const [langChanging, setLangChanging] = useState(false);
```

### Handler

There are exactly **2 call sites** to replace, both in `page.tsx` lines 545–546:

```tsx
// CURRENT (lines 545–546) — replace both onClick handlers:
<button ... onClick={() => setLang("no")}>NO</button>
<button ... onClick={() => setLang("en")}>EN</button>

// AFTER:
<button ... onClick={() => handleLangSwitch("no")}>NO</button>
<button ... onClick={() => handleLangSwitch("en")}>EN</button>
```

Define `handleLangSwitch` as a `useCallback` near the other callbacks in `page.tsx`:

```tsx
const handleLangSwitch = useCallback((newLang: "no" | "en") => {
  if (newLang === lang) return;
  setLangChanging(true);
  setTimeout(() => {
    setLang(newLang);
    // Double rAF defers class removal to a separate paint cycle, ensuring
    // the browser commits the new language content before the fade-in fires.
    // (setLangChanging is a stable setter — no need in deps array.)
    requestAnimationFrame(() => requestAnimationFrame(() => setLangChanging(false)));
  }, 160); // 160ms > 130ms CSS fade-out, guarantees fade-out completes before text swaps
}, [lang]);
```

### State

`lang` is local `useState<"no" | "en">` in `page.tsx` — no context or external store. No persistence side-effects to worry about.

### Class application

`<main>` at line 552 already carries `className="cards-container"` plus a `ref` and event handlers. Append `lang-transitioning` without replacing anything else:

```tsx
// CURRENT (line 552):
<main className="cards-container" ref={scrollRef} onScroll={handleScroll} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>

// AFTER:
<main className={`cards-container${langChanging ? " lang-transitioning" : ""}`} ref={scrollRef} onScroll={handleScroll} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
```

### CSS

Add to `globals.css`. Use **opacity only** — no `transform` — to avoid creating a new stacking context on the scroll container (which would affect any fixed/absolute-positioned modals inside the tree). Target `.cards-container` (the actual class on `<main>`) rather than the bare `main` element selector to be explicit:

```css
.cards-container {
  transition: opacity 0.25s ease;
}

.cards-container.lang-transitioning {
  opacity: 0.35;
  transition: opacity 0.13s ease;
}
```

The asymmetry is intentional: fade-out is fast (0.13s) so it feels snappy, fade-in is slower (0.25s) so the content arrives gently.

> **Note:** The mobile `@media` block overrides `.lang-btn` padding but not `transition` or `transform`, so no conflict exists there.

## Scope of Content Animation

Everything inside `<main className="cards-container">` animates together:
- Hero title ("Dagens Lunsj" / "Today's Lunch")
- Day selector labels (Mandag–Fredag / Monday–Friday)
- Week label ("Uke X" / "Week X")
- Food card names and descriptions
- Allergen labels

The lang switcher buttons sit outside `<main>` in the header and animate independently.

**Modals (action sheet, recipe modal, vote modal, info modal):** These are rendered as inline JSX siblings after `<main>` in `page.tsx` — outside the `.cards-container` subtree. Their text updates instantly when lang changes. This is intentional and acceptable: modals are triggered by user interaction and will virtually never be open at the same time as a lang switch.

## Files Changed

| File | Change |
|------|--------|
| `src/app/globals.css` | Update `.lang-btn`, `.lang-btn.active`; add `.cards-container` transition and `.cards-container.lang-transitioning` rules |
| `src/app/page.tsx` | Add `langChanging` state, `handleLangSwitch` callback, apply class to `<main>` |

## Out of Scope

- Animating individual words or characters within text nodes
- Any animation on content that does not change between languages (food images, vote counts, canteen names)
- `lang` persistence to localStorage — `lang` is local state only; no side-effects need reordering

## Deliberate Accessibility Debt

`prefers-reduced-motion` support is not included in this implementation. Users with motion sensitivity will still see the opacity fade and button scale. This should be addressed in a follow-up:

```css
@media (prefers-reduced-motion: reduce) {
  .lang-btn, .cards-container { transition: none; }
}
```
