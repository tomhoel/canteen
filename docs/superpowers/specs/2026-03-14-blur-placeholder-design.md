# Blur Placeholder for Food Card Images

**Date:** 2026-03-14
**Status:** Approved

## Problem

Food card images take a second to load on first visit. Currently the image area is blank until the PNG arrives, which looks unpolished.

## Goal

Show a blurry low-resolution preview of the actual food image immediately on page load, then fade the full-res image in once it arrives — the classic blur-up effect.

## Constraints

- Use only packages already installed (`sharp` is a devDependency, `next` and `react` are main deps)
- No layout changes — keep existing `<img>` tags and CSS-managed sizing
- Must not affect the existing letter-fallback error state
- Images are transparent-background PNGs (`public/images_nobg/{day}/{slug}.png`)

---

## Architecture

### 1. Script: `scripts/generate-blur-map.ts`

A one-off Node/TypeScript script that:

1. Recursively scans `public/images_nobg/` for all `.png` files
2. For each file, uses `sharp` to resize to **12×12 px** and encode as base64 JPEG (JPEG chosen over PNG for smaller payload; transparency is lost but the blur is decorative)
3. Builds a `Record<string, string>` keyed by the public URL path (e.g. `/images_nobg/monday/flow.png` → `data:image/jpeg;base64,...`)
4. Writes the result to `src/lib/blurMap.ts` as a typed export

Output example:
```ts
// AUTO-GENERATED — do not edit manually. Run: npm run generate-blur-map
export const blurMap: Record<string, string> = {
  "/images_nobg/monday/flow.png": "data:image/jpeg;base64,/9j/4AAQ...",
  ...
};
```

The script is wired into `package.json`:
- `"generate-blur-map": "npx ts-node --project tsconfig.json scripts/generate-blur-map.ts"`
- Added to the `build` script: `"build": "npm run generate-blur-map && next build"`
- Added to `postinstall`: `"postinstall": "npm run generate-blur-map"`

### 2. FoodCard changes (`src/components/FoodCard.tsx`)

- Import `blurMap` from `src/lib/blurMap`
- Add `loaded` boolean state (default `false`)
- On mount (`useEffect`), check `img.complete` — if already cached, set `loaded = true` immediately
- Pass `blurMap[imagePath]` (or `undefined` if not found) to the image wrapper as an inline `background-image` style
- Add `onLoad` handler to the `<img>` that sets `loaded = true`
- Add `loaded` CSS class to the `<img>` when loaded

### 3. CSS changes (`src/app/globals.css`)

```css
/* Blur placeholder shown while food image loads */
.card-image-circle {
  background-size: cover;
  background-position: center;
}

.food-image {
  opacity: 0;
  transition: opacity 0.35s ease;
}

.food-image.loaded {
  opacity: 1;
}
```

The blur background on `.card-image-circle` is set via inline style. Once `.food-image.loaded` reaches `opacity: 1`, it covers the blur background entirely.

**Outdated card image** already has `filter: grayscale(55%)` — this is unchanged; the blur placeholder simply won't be greyscaled (it's a background, not the img). Acceptable trade-off since the placeholder is only visible for a fraction of a second.

---

## Edge Cases

| Case | Behaviour |
|------|-----------|
| Image already in browser cache | `img.complete` is true on mount → `loaded = true` immediately → no blur flash |
| Image load error | `imgError` state shows letter fallback as before; `loaded` never flips |
| `imagePath` not in `blurMap` | `background-image` is `undefined` → no placeholder, graceful degradation |
| New images added to menu | Script re-runs on next `npm install` or `build`, map auto-updates |
| Outdated card (`filter: grayscale`) | Blur placeholder is not greyscaled; acceptable since it's brief |

---

## Files Changed

| File | Change |
|------|--------|
| `scripts/generate-blur-map.ts` | New — generates blur map |
| `src/lib/blurMap.ts` | New (generated) — `Record<string, string>` of blur data URLs |
| `src/components/FoodCard.tsx` | Add `loaded` state, blur background, `onLoad` handler |
| `src/app/globals.css` | Add `.food-image` opacity transition and `.food-image.loaded` |
| `package.json` | Add `generate-blur-map` script, wire into `build` and `postinstall` |

---

## Out of Scope

- Lightbox image (action sheet `<img>`) — different loading pattern, separate concern
- Flag images — tiny, load instantly
- Next.js `<Image>` migration — not needed for this feature
