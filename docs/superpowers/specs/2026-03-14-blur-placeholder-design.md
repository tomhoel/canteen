# Blur Placeholder for Food Card Images

**Date:** 2026-03-14
**Status:** Approved

## Problem

Food card images take a second to load on first visit. Currently the image area is blank until the PNG arrives.

## Goal

Show a blurry low-resolution preview of the actual food image immediately on page load, then fade the full-res image in once it arrives — the classic blur-up effect.

## Constraints

- Use only packages already installed (`sharp` is a devDependency)
- No layout changes — keep existing `<img>` tags and CSS-managed sizing
- Must not affect the existing letter-fallback error state
- Images are transparent-background PNGs (`public/images_nobg/{day}/{slug}.png`)
- Images are committed to the repo (not generated at runtime)

---

## Architecture

### 1. Script: `scripts/generate-blur-map.mjs`

Written as **plain JavaScript ES module** (`.mjs`) — no TypeScript runner needed, runs with `node` directly:

```
node scripts/generate-blur-map.mjs
```

What it does:
1. Recursively scans `public/images_nobg/` for all `.png` files
2. For each file, uses `sharp` to:
   - **Flatten** the transparent background to `{ r: 245, g: 240, b: 232 }` (the app's `--bg-cream` colour) before resizing — this ensures the JPEG placeholder shows warm food colours rather than a white or black box
   - Resize to **12×12 px**
   - Encode as base64 JPEG
3. Keys each entry as `/images_nobg/{day}/{slug}.png` — leading slash, no `public/` prefix — matching the `imagePath` prop format already used in `FoodCard`
4. Writes `src/lib/blurMap.ts` with an `// AUTO-GENERATED` header

Output format:
```ts
// AUTO-GENERATED — do not edit manually. Run: node scripts/generate-blur-map.mjs
export const blurMap: Record<string, string> = {
  "/images_nobg/monday/flow.png": "data:image/jpeg;base64,/9j/4AAQ...",
};
```

`package.json` changes:
- Add `"generate-blur-map": "node scripts/generate-blur-map.mjs"`
- Prepend to `build`: `"build": "npm run generate-blur-map && next build"`
- **Do not add to `postinstall`** — unreliable ordering on Vercel

**`src/lib/blurMap.ts` is committed to the repo.** It is ~3 KB for 15 images and generated from committed assets. This avoids a TypeScript compilation failure before the script has run. When new images are added (weekly via `scraper.js`), developers must re-run `npm run generate-blur-map` and commit the updated file. This is an accepted workflow — there is no automated drift check. Stale map entries produce no visual defect (missing key → no placeholder, graceful).

The exact `build` script in `package.json` becomes:
```json
"build": "node scripts/generate-blur-map.mjs && next build"
```

---

### 2. FoodCard changes (`src/components/FoodCard.tsx`)

```tsx
import { blurMap } from "@/lib/blurMap";

// Inside component:
const imgRef = useRef<HTMLImageElement>(null);
const [loaded, setLoaded] = useState(false);

// Check if image is already in browser cache on mount
// Uses naturalWidth > 0 to distinguish loaded from broken/empty src
// React 19 Strict Mode double-invokes useEffect; this check is idempotent — safe
useEffect(() => {
  if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) {
    setLoaded(true);
  }
}, []);

const blurDataUrl = blurMap[imagePath]; // undefined if not in map → graceful degradation
```

`.card-image-circle` wrapper — blur applied via inline style, cleared in error state:
```tsx
<div
  className="card-image-circle"
  style={!imgError && blurDataUrl ? {
    backgroundImage: `url(${blurDataUrl})`,
    backgroundSize: "cover",
    backgroundPosition: "center",
  } : undefined}
>
```

**Note:** `.card-image-circle` has `border-radius: 50%` which clips the background to a circle — verified correct shape. No `background-clip` override exists in the current codebase.

**`imgError` is mutually exclusive with `<img>`:** when `imgError` is true, the component renders a `<div class="image-placeholder">` instead of the `<img>`. The `opacity: 0` base style on `.food-image` therefore never touches the error state. The `!imgError` guard on the blur background style is belt-and-suspenders only.

`<img>` element — include `ref`, `loaded` class, preserve existing `alt`:
```tsx
<img
  ref={imgRef}
  src={imagePath}
  alt={mainDish?.dish || "Matrett"}
  className={`food-image${loaded ? " loaded" : ""}`}
  loading="lazy"
  onLoad={() => setLoaded(true)}
  onError={() => setImgError(true)}
/>
```

**Float animation behaviour:** `gentleFloat` is `animation: gentleFloat 5s ease-in-out infinite` and runs from frame 0 regardless of `opacity`. When the image fades in, it will already be mid-animation cycle. This is accepted — the visual result is imperceptible since the float is subtle and continuous.

---

### 3. CSS changes (`src/app/globals.css`)

**Only two changes** — both target `.food-image`. The `.card-image-circle` CSS rule does **not** need changes (background properties are set entirely via inline style):

**Extend `.food-image` opacity** — add `opacity: 0` and extend the existing transition (do not replace `filter 0.4s ease`):
```css
.food-image {
  /* ...all existing properties unchanged... */
  opacity: 0;
  transition: opacity 0.35s ease, filter 0.4s ease; /* replaces existing single-value transition */
}

.food-image.loaded {
  opacity: 1;
}
```

No changes to `.card-image-circle` CSS.

---

## Edge Cases

| Case | Behaviour |
|------|-----------|
| Image already in browser cache | `img.complete && naturalWidth > 0` on mount → `loaded = true` after one render. One-frame `opacity: 0` flash is unavoidable (refs not populated during render); imperceptible in practice |
| Image load error | `imgError = true` → letter fallback; blur background not applied (conditional on `!imgError`) |
| `imagePath` not in `blurMap` | `blurDataUrl` is `undefined` → no `background-image` set, graceful |
| New images added | Re-run `node scripts/generate-blur-map.mjs` and commit updated `blurMap.ts` |
| Outdated card (`filter: grayscale`) | Blur placeholder not greyscaled; acceptable, placeholder is only visible <1s |
| SSR | `loaded` starts `false` — correct, image hasn't loaded on server |
| React Strict Mode double-invoke | `useEffect` check is idempotent — safe |

---

## Files Changed

| File | Change |
|------|--------|
| `scripts/generate-blur-map.mjs` | New — generates blur map using sharp |
| `src/lib/blurMap.ts` | New (generated, committed) — `Record<string, string>` |
| `src/components/FoodCard.tsx` | Add `imgRef`, `loaded` state, blur background style, cache check |
| `src/app/globals.css` | Extend `.food-image` transition; add `opacity: 0`/`.loaded` |
| `package.json` | Add `generate-blur-map` script, prepend to `build` |

---

## Out of Scope

- Lightbox / action sheet image
- Flag images (tiny, load instantly)
- Next.js `<Image>` migration
