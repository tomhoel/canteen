# Language Switcher Animation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add spring-physics button animation and a full-page opacity fade when switching between NO and EN.

**Architecture:** Two independent changes — (1) CSS-only button animation using `transform: scale` with spring easing, and (2) a `langChanging` boolean state that applies a CSS class to `<main>` for 160ms, creating a fade-out/fade-in envelope around each language switch.

**Tech Stack:** Next.js 16, React 19, TypeScript, plain CSS (no animation libraries)

---

## Chunk 1: CSS Button Animation + Content Fade

**Files:**
- Modify: `src/app/globals.css` (lines 142–158 for button rules; new rules appended after)

### Task 1: Update `.lang-btn` transition and inactive state

- [ ] **Step 1: Open `src/app/globals.css` and locate the `.lang-btn` rule (line 142)**

  Current rule to replace:

  ```css
  .lang-btn {
    border: none;
    background: transparent;
    padding: 8px 20px;
    font-size: clamp(12px, 2.5vw, 14px);
    font-weight: 600;
    color: var(--text-secondary);
    border-radius: 50px;
    cursor: pointer;
    transition: all 0.3s ease;
  }
  ```

- [ ] **Step 2: Replace the `.lang-btn` rule with the following** (adds explicit `transform` and replaces `transition: all` with a targeted spring transition):

  ```css
  .lang-btn {
    border: none;
    background: transparent;
    padding: 8px 20px;
    font-size: clamp(12px, 2.5vw, 14px);
    font-weight: 600;
    color: var(--text-secondary);
    border-radius: 50px;
    cursor: pointer;
    transform: scale(1.0);
    transition: background 0.25s cubic-bezier(0.34, 1.56, 0.64, 1),
                color 0.25s ease,
                transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1),
                box-shadow 0.25s ease;
  }
  ```

  > `cubic-bezier(0.34, 1.56, 0.64, 1)` is a spring curve — it overshoots slightly before settling, giving the scale a tactile pop. `transition: all` is replaced because it is too broad and prevents fine-grained control.

- [ ] **Step 3: Replace the `.lang-btn.active` rule (line 154)** (same location, strengthen shadow, add scale):

  Current:

  ```css
  .lang-btn.active {
    background: var(--accent-orange);
    color: white;
    box-shadow: 0 2px 10px rgba(200, 116, 26, 0.45);
  }
  ```

  Replace with:

  ```css
  .lang-btn.active {
    background: var(--accent-orange);
    color: white;
    transform: scale(1.08);
    box-shadow: 0 3px 16px rgba(200, 116, 26, 0.55);
  }
  ```

- [ ] **Step 4: Verify no duplicate `transition` or `transform` properties exist in the `.lang-btn` block** — the mobile `@media` block (around line 1083) overrides padding only, not transition/transform, so no conflict.

### Task 2: Add content fade CSS rules

- [ ] **Step 1: Append the following two rules to `src/app/globals.css`** after the existing `.lang-btn.active` block (after line 158). Place them under the existing `/* Language Switcher */` section comment:

  ```css
  .cards-container {
    transition: opacity 0.25s ease;
  }

  .cards-container.lang-transitioning {
    opacity: 0.35;
    transition: opacity 0.13s ease;
  }
  ```

  > **Why two transition values?** The base rule controls the fade-in (0.25s, slower — content arrives gently). The `.lang-transitioning` override controls the fade-out (0.13s, faster — feels snappy). CSS specificity ensures `.lang-transitioning` wins during the out phase.
  >
  > **Why opacity only?** `transform` on a scroll container creates a new stacking context, which can clip or reposition fixed/absolute children. Opacity is safe.

- [ ] **Step 2: Commit the CSS changes**

  ```bash
  git add src/app/globals.css
  git commit -m "feat: spring-physics lang button animation and content fade CSS"
  ```

---

## Chunk 2: React State + Handler

**Files:**
- Modify: `src/app/page.tsx` (add state near line 16, add callback near existing callbacks, update line 545–546 and 552)

### Task 3: Add `langChanging` state

- [ ] **Step 1: Open `src/app/page.tsx` and find the existing state declarations (around line 16)**

  Current block starts with:

  ```tsx
  const [menuData, setMenuData] = useState<MenuData | null>(null);
  const [lang, setLang] = useState<"no" | "en">("no");
  ```

- [ ] **Step 2: Add `langChanging` state on the line immediately after the `lang` state**:

  ```tsx
  const [lang, setLang] = useState<"no" | "en">("no");
  const [langChanging, setLangChanging] = useState(false);
  ```

### Task 4: Add `handleLangSwitch` callback

- [ ] **Step 1: Find where the other `useCallback` handlers are defined in `page.tsx`** (search for `useCallback` — there are several, e.g. `fetchRecipe`, `fetchDeals`).

- [ ] **Step 2: Add `handleLangSwitch` alongside the other callbacks**:

  ```tsx
  const handleLangSwitch = useCallback((newLang: "no" | "en") => {
    if (newLang === lang) return;
    setLangChanging(true);
    setTimeout(() => {
      setLang(newLang);
      // Double rAF defers class removal to a separate paint cycle, ensuring
      // the browser commits the new language content before the fade-in fires.
      requestAnimationFrame(() => requestAnimationFrame(() => setLangChanging(false)));
    }, 160); // 160ms > 130ms CSS fade-out duration
  }, [lang]);
  ```

  > `lang` is in the dependency array because the guard `if (newLang === lang) return` reads it. `setLang` and `setLangChanging` are stable React setters and do not need to be listed.

### Task 5: Wire up the handler to the buttons and `<main>`

- [ ] **Step 1: Find the lang button JSX (lines 545–546)**:

  ```tsx
  <button className={lang === "no" ? "lang-btn active" : "lang-btn"} onClick={() => setLang("no")}>NO</button>
  <button className={lang === "en" ? "lang-btn active" : "lang-btn"} onClick={() => setLang("en")}>EN</button>
  ```

- [ ] **Step 2: Replace both `onClick` handlers** (className attributes stay the same):

  ```tsx
  <button className={lang === "no" ? "lang-btn active" : "lang-btn"} onClick={() => handleLangSwitch("no")}>NO</button>
  <button className={lang === "en" ? "lang-btn active" : "lang-btn"} onClick={() => handleLangSwitch("en")}>EN</button>
  ```

- [ ] **Step 3: Find the `<main>` element (line 552)**:

  ```tsx
  <main className="cards-container" ref={scrollRef} onScroll={handleScroll} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
  ```

- [ ] **Step 4: Update the `className` to include the fade class when transitioning** (all other props unchanged):

  ```tsx
  <main className={`cards-container${langChanging ? " lang-transitioning" : ""}`} ref={scrollRef} onScroll={handleScroll} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add src/app/page.tsx
  git commit -m "feat: add lang switch content fade animation"
  ```

---

## Chunk 3: Manual Verification + Push

### Task 6: Visual verification

- [ ] **Step 1: Start dev server**

  ```bash
  npm run dev
  ```

  Open `http://localhost:3000` in a browser.

- [ ] **Step 2: Verify button animation**
  - Click NO → EN. The EN button should briefly scale up past its resting size before settling (spring overshoot). The NO button should shrink back to scale(1.0) with a glow fading out.
  - Click EN → NO. Same but reversed.
  - Rapid-clicking should not break anything — the `if (newLang === lang) return` guard prevents double-firing.

- [ ] **Step 3: Verify content fade**
  - Click either lang button. The entire `<main>` content (hero title, day labels, food cards) should briefly dim to ~35% opacity and then fade back in showing updated text.
  - The lang buttons in the header should **not** fade — they are outside `<main>`.
  - Food images, vote count numbers, and canteen names can update without fading (they don't change between languages).

- [ ] **Step 4: Verify no layout breakage**
  - Scroll through the food cards — no clipping or reflow issues.
  - Open the action sheet (tap a food card) then switch language — modal text updates instantly (acceptable, per spec).
  - Check on a narrow viewport (375px) — day selector and food cards still render correctly.

### Task 7: Push

- [ ] **Step 1: Push to main**

  ```bash
  git push origin main
  ```
