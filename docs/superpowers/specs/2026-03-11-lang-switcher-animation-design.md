# Language Switcher Animation — Design Spec

**Date:** 2026-03-11
**Status:** Approved

## Overview

Add polished animation to the language switcher (NO/EN toggle) and animate page content when the language changes. The goal is a tactile, satisfying feel — the button pops with spring physics, and all translatable UI text fades and shifts slightly before updating.

## Button Animation — Morph + Scale

Update `.lang-btn` and `.lang-btn.active` in `src/app/globals.css`.

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

Replace direct `setLang` calls on the lang buttons with `handleLangSwitch`:

```tsx
const handleLangSwitch = useCallback((newLang: "no" | "en") => {
  if (newLang === lang) return;
  setLangChanging(true);
  setTimeout(() => {
    setLang(newLang);
    setLangChanging(false);
  }, 130);
}, [lang]);
```

### Class application

Apply `lang-transitioning` to `<main>` when `langChanging` is true:

```tsx
<main className={langChanging ? "lang-transitioning" : ""}>
```

### CSS

Add to `globals.css`:

```css
main {
  transition: opacity 0.25s ease, transform 0.25s ease;
}

main.lang-transitioning {
  opacity: 0.35;
  transform: translateY(5px);
  transition: opacity 0.13s ease, transform 0.13s ease;
}
```

The asymmetry is intentional: fade-out is fast (0.13s) so it feels snappy, fade-in is slower (0.25s) so the content arrives gently.

## Scope of Content Animation

Everything inside `<main>` animates together:
- Hero title ("Dagens Lunsj" / "Today's Lunch")
- Day selector labels (Mandag–Fredag / Monday–Friday)
- Week label ("Uke X" / "Week X")
- Food card names and descriptions
- Allergen labels
- All action sheet, recipe modal, and info modal UI strings

The lang switcher buttons themselves sit outside `<main>` in the header, so they animate independently.

## Files Changed

| File | Change |
|------|--------|
| `src/app/globals.css` | Update `.lang-btn`, `.lang-btn.active`; add `main` and `main.lang-transitioning` rules |
| `src/app/page.tsx` | Add `langChanging` state, `handleLangSwitch` callback, apply class to `<main>` |

## Out of Scope

- Animating individual words or characters within text nodes
- Any animation on content that does not change between languages (food images, vote counts, canteen names)
- Dark mode or reduced-motion variants (can be added later)
