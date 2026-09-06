# Building with canteen

canteen is a staff-canteen lunch app for Telenor Fornebu. It answers one
question — *what's for lunch today* — with three cards on one screen, no
scrolling. **All copy is Norwegian.** Write Norwegian, not English.

## Setup

**No provider is required.** Import a component and render it.

```jsx
<FoodCard data={item} cardIdx={0} selectedDay={2} todayIndex={2}
          voteCount={0} maxVotes={0}
          onImageClick={openLightbox} onCardClick={openSheet} />
```

The one exception: `SheetContent` reads open state from `Sheet` context and
renders nothing on its own — always compose the pair.

```jsx
<Sheet open={open} onOpenChange={setOpen}>
  <SheetContent aria-label="Detaljer" onClose={close}>…</SheetContent>
</Sheet>
```

**`PreviewFrame` is not part of the vocabulary.** It exists only to freeze
animations for the preview screenshots. Never render it in a design.

## The styling idiom: CSS custom properties

There are no utility classes and no style props. Components carry their own
class names and ship their own CSS; **your layout glue uses the tokens**. Never
invent a hex value — every colour, size, radius and shadow below is defined in
the stylesheet you already have.

| Family | Tokens |
|---|---|
| Ground | `--bg-cream` `--bg-warm` `--card-white` `--border-light` |
| Text | `--text-primary` `--text-secondary` `--text-muted` |
| Accent | `--accent-orange` `--accent-orange-ink` `--accent-green` `--accent-yellow` `--accent-coral` `--accent-rose` |
| Type | `--fs-label` `--fs-meta` `--fs-body` `--fs-title` `--fs-hero` · `--lh-tight` `--lh-snug` `--lh-body` |
| Space | `--sp-0` `--sp-1` `--sp-2` `--sp-3` `--sp-4` `--sp-5` `--sp-6` `--sp-8` `--sp-12` |
| Radius | `--r-xs` `--r-sm` `--r-md` `--r-lg` `--r-pill` `--r-round` |
| Elevation | `--e-1` `--e-2` `--e-3` `--e-4` |
| Motion | `--dur-fast` `--dur-base` `--dur-slow` · `--spring` `--smooth` |

Three rules the tokens cannot enforce, all verified by a contrast gate in the
repo:

1. **Orange has two roles and they are not interchangeable.**
   `--accent-orange` is decorative only — fills, borders, dots, tints. Any text,
   **and any surface carrying white text**, takes `--accent-orange-ink`. Using
   the decorative value for text is this codebase's most common past failure.
2. **Never use `opacity` to make text quieter.** Colour carries de-emphasis.
   An opacity multiplier is invisible to a contrast audit and hid four real AA
   failures here, the worst at 1.59:1.
3. **`--r-lg` (24px) is the identity radius.** Cards, modals and sheets use it.
   Do not drift it.

## Where the truth lives

- `_ds/<folder>/styles.css` and its `@import` closure — the real tokens and
  every component's CSS. Read it before styling anything.
- `components/<Group>/<Name>/<Name>.d.ts` — the props contract.
- `components/<Group>/<Name>/<Name>.prompt.md` — per-component usage.

## An idiomatic composition

The home screen: a header, the three-card row, the day bar.

```jsx
<div style={{ background: "var(--bg-cream)", minHeight: "100dvh" }}>
  <AppHeader mode="weekday-current" displayWeek={37}
             dayLabel="Mandag" dateStr="8. september" actions={actions}>
    <ClosedCanteensPill closedCanteens={closed} />
  </AppHeader>

  <div style={{ display: "flex", gap: "var(--sp-6)", padding: "0 var(--sp-6)" }}>
    {open.map((item, i) =>
      item.mainDish
        ? <FoodCard key={item.canteenName} data={item} cardIdx={i} {...voting} />
        : <ClosedCard key={item.canteenName} data={item} cardIdx={i} />
    )}
  </div>

  <DaySelector fullDayLabels={days} dayLabelsData={dates}
               selectedDay={2} todayIndex={2}
               mode="weekday-current" onDaySelect={setDay} />
</div>
```

Two structural facts worth honouring: when **every** canteen is shut, one
`AllClosedCard` replaces the whole row rather than three `ClosedCard`s; and
`DaySelector` is `position: fixed`, so it needs a transformed ancestor if you
want it contained rather than pinned to the viewport.
