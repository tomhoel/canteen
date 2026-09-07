"use client";

import { useState, useEffect, useMemo, useRef, useCallback, lazy, Suspense } from "react";
import { useSearch, setSearchParam } from "@/lib/useSearch";
import { fireConfetti, showToast } from "@/lib/lazy-effects";
import { markImageCached } from "@/lib/imageCache";
import { Share2 } from "lucide-react";
import { FULL_DAYS_NO, DAY_KEYS, CANTEEN_ORDER, CANTEEN_IMAGE_SLUGS, getSupabaseImageUrl, getClosedPlateUrl, PLATE_CARD_WIDTH } from "@/lib/constants";
import type { MenuData, CanteenData, CanteenDayItem, DishOrigin, DishDescription } from "@/lib/types";
import {
  getLocalDateKey,
  computeDisplayContext,
  compareWeeks,
  parseCanteenWeekNumber,
  weekDayLabels,
  formatLongDate,
} from "@/lib/dateUtils";
import { useVoting } from "@/lib/useVoting";
import { useRecipe } from "@/lib/useRecipe";
import { useDeals } from "@/lib/useDeals";
import { useMenySearch } from "@/lib/useMenySearch";
import ErrorBoundary from "@/components/ErrorBoundary";
import LoadingScreen from "@/components/LoadingScreen";
import { useIsDesktop } from "@/lib/useIsDesktop";
import AppHeader from "@/components/AppHeader";
import DaySelector from "@/components/DaySelector";
import ClosedCanteensPill from "@/components/ClosedCanteensPill";
import DayPanel from "@/components/DayPanel";
import { isCanteenClosed, getRankedItems } from "@/lib/canteen-utils";
import { useShellInert } from "@/lib/useShellInert";
import { useDaySwipe } from "@/lib/useDaySwipe";
import { cleanupLocalStorage } from "@/lib/cleanupLocalStorage";

// These only render once the user opens a modal or overlay — a recipe's
// price comparison, the Meny search, the feedback form, the vote/leaderboard/
// image-lightbox/week-overview overlays. Importing them eagerly put every one
// of them (and their own dependencies, e.g. Lightbox's copy of `motion`) in
// the same chunk the very first paint has to wait on. Splitting them out, and
// only mounting each one once its own "open" condition is true (see the call
// sites below), means a visitor who never opens any of these never pays for
// their JS at all.
const Lightbox = lazy(() => import("@/components/Lightbox"));
const LeaderboardModal = lazy(() => import("@/components/LeaderboardModal"));
const WeekOverview = lazy(() => import("@/components/WeekOverview"));
// The action sheet belongs in that list too, and was the one overlay left out
// of it. It is only reachable by tapping a card, but importing it eagerly put
// `ui/sheet.tsx` and with it the whole of `@use-gesture/react` — the
// drag-to-dismiss gesture, needed by nothing else in the app — into the chunk
// the first paint waits on.
const ActionSheet = lazy(() => import("@/components/ActionSheet"));
const InfoModal = lazy(() => import("@/components/InfoModal"));
const RecipeModal = lazy(() => import("@/components/RecipeModal"));

export interface HomeClientProps {
  initialMenu: MenuData | null;
  /** The week the server actually served, so the header cannot label it wrong. */
  servedWeekId: string;
  initialOrigins: Record<string, DishOrigin>;
  initialDescriptions: Record<string, DishDescription>;
  /** Dish name -> shortened headline. Empty for a week nothing was shortened in. */
  initialShortNames: Record<string, string>;
  /**
   * Storage path per card, keyed `"<day>|<canteen name>"`, resolved server-side.
   *
   * The client used to build `<day>/<canteen>.png` itself — a slot with no week
   * in it, so only one week's plates could exist and any other week's cards
   * showed the wrong food. Only the server can do better: it knows, via
   * dish_cache, which dish each stored plate depicts.
   */
  plateImages: Record<string, string>;
}


export default function HomeClient({ initialMenu, servedWeekId, initialOrigins, initialDescriptions, initialShortNames, plateImages }: HomeClientProps) {
  const searchParams = useSearch();

  const [selectedDay, setSelectedDay] = useState(() => {
    if (searchParams?.day) {
      const idx = DAY_KEYS.indexOf(searchParams.day.toLowerCase() as typeof DAY_KEYS[number]);
      if (idx >= 0) return idx;
    }
    const { defaultSelectedDay } = computeDisplayContext(
      initialMenu
        ? Object.values(initialMenu.canteens || {})
            .map((c) => parseCanteenWeekNumber(c.week))
            .filter((n): n is number => n !== null)
        : [],
      searchParams?.week,
      servedWeekId
    );
    return defaultSelectedDay;
  });

  useEffect(() => {
    if (searchParams?.day) {
      const idx = DAY_KEYS.indexOf(searchParams.day.toLowerCase() as typeof DAY_KEYS[number]);
      if (idx >= 0 && idx !== selectedDay) {
        setSelectedDay(idx);
      }
    }
    // Deliberately keyed on the search param alone. `selectedDay` is read above
    // but must not be a dependency: selecting a day sets the state first and
    // pushes `?day=` second, so a render exists where the two disagree — and an
    // effect that re-ran on `selectedDay` would see that gap and put it back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams?.day]);

  const [menuData, setMenuData] = useState<MenuData | null>(initialMenu);
  const isDesktop = useIsDesktop();
  // Desktop renders the plate in a 261px box and phones in a 160px one, so a
  // single width is wrong for one of them. See PLATE_CARD_WIDTH.
  const plateWidth = isDesktop ? PLATE_CARD_WIDTH.desktop : PLATE_CARD_WIDTH.mobile;
  const [lightboxIndex, setLightboxIndex] = useState(-1);
  const [mounted, setMounted] = useState(false);
  // Bumped on visibilitychange + every 5 min to refresh date logic without reload.
  const [dateTick, setDateTick] = useState(0);
  const [actionSheet, setActionSheet] = useState<{ isOpen: boolean; canteenName: string; dishName: string; imagePath: string; description: string | null }>({ isOpen: false, canteenName: "", dishName: "", imagePath: "", description: null });
  const [dishOrigins, setDishOrigins] = useState<Record<string, DishOrigin>>(initialOrigins);
  const [dishDescriptions, setDishDescriptions] = useState<Record<string, DishDescription>>(initialDescriptions);
  const [dishShortNames, setDishShortNames] = useState<Record<string, string>>(initialShortNames);

  useEffect(() => {
    setMenuData(initialMenu);
    setDishOrigins(initialOrigins);
    setDishDescriptions(initialDescriptions);
    setDishShortNames(initialShortNames);
  }, [initialMenu, initialOrigins, initialDescriptions, initialShortNames]);
  /**
   * The day change, as two panels instead of an AnimatePresence.
   *
   * `current` is the day on screen and `leaving` is the one still sliding out;
   * `seq` is what keys them, so returning to a day that is still leaving gets a
   * brand-new panel rather than reversing the old one. Both live in the track's
   * single grid cell — see DayPanel for why that is enough.
   */
  const [current, setCurrent] = useState({ seq: 0, day: selectedDay });
  const [leaving, setLeaving] = useState<{ seq: number; day: number; dir: number } | null>(null);
  const [dayDir, setDayDir] = useState(0);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [weekOverviewOpen, setWeekOverviewOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  // YOLO randomiser: cycles a glow through the open canteens for ~5s then
  // settles on one. yoloHighlight is the currently-lit card during the spin;
  // yoloWinner is the finalist after deceleration completes.
  const [yoloSpinning, setYoloSpinning] = useState(false);
  const [yoloHighlight, setYoloHighlight] = useState<number>(-1);
  const [yoloWinner, setYoloWinner] = useState<number>(-1);
  const yoloTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Custom hooks — extracted state management. Everything below reaches voting
  // state through `voting.x`; the destructure that used to sit here bound ten
  // names nothing referenced.
  const voting = useVoting();
  const { recipeModal, recipeServings, setRecipeServings, handleRecipeClick, closeRecipe } = useRecipe();
  const { dealsView, handleDealsClick, closeDeals } = useDeals();
  const { menyView, handleMenyClick, closeMeny } = useMenySearch();

  /**
   * Is anything layered over the day view?
   *
   * There were four separate hand-written versions of this question — one per
   * ArrowLeft, ArrowRight, Space and the touch guard — and no two of them
   * listed the same overlays. The arrow keys did not know about the
   * leaderboard, the week overview, the Meny search or the deals view, and the
   * touch guard did not know about the last two either. So the day changed
   * underneath an open overlay: arrow keys with the leaderboard up, a swipe
   * with the deals view up.
   *
   * One derived value instead. Adding an overlay now means adding it here,
   * once, rather than remembering four lists.
   *
   * The Escape handler deliberately does NOT use this: it is a priority chain
   * ("close the innermost thing first"), and the order it walks is a real
   * decision — Escape inside the Meny sub-view returns to the recipe rather
   * than closing everything.
   */
  const anyOverlayOpen =
    infoOpen ||
    leaderboardOpen ||
    weekOverviewOpen ||
    actionSheet.isOpen ||
    recipeModal.isOpen ||
    menyView.isOpen ||
    dealsView.isOpen ||
    lightboxIndex >= 0;

  // The overlays that render inline in this file rather than as components
  // that claim it themselves. ActionSheet claims via ui/sheet, and the
  // leaderboard and week overview each claim in their own component — the
  // refcount makes an overlap harmless, but listing only the inline ones keeps
  // it obvious which surface owns which claim.
  useShellInert(
    infoOpen || recipeModal.isOpen || menyView.isOpen || dealsView.isOpen || lightboxIndex >= 0
  );

  /** Has the action sheet ever been opened? See its render block for why. */
  const sheetEverOpened = useRef(false);

  const scrollRef = useRef<HTMLElement>(null);

  // Debounced scroll position save
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track preloaded image URLs to avoid duplicates (#5)
  const preloadedRef = useRef<Set<string>>(new Set());

  // Restore scroll position after mount and data load
  useEffect(() => {
    if (mounted && scrollRef.current) {
      const savedScroll = localStorage.getItem("canteenScrollPos");
      if (savedScroll !== null) {
        setTimeout(() => {
          if (scrollRef.current) scrollRef.current.scrollTop = parseInt(savedScroll, 10);
        }, 10);
      }
    }
  }, [mounted, menuData]);

  // Debounced scroll handler (200ms)
  const handleScroll = useCallback((e: React.UIEvent<HTMLElement>) => {
    const top = e.currentTarget.scrollTop;
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = setTimeout(() => {
      localStorage.setItem("canteenScrollPos", top.toString());
    }, 200);
  }, []);

  /**
   * Did this day change come from a swipe rather than a tap on the day bar?
   *
   * A tap runs one animation: the day's own entrance. A swipe runs two — the
   * strip springing home from where the finger left it, AND the day's entrance
   * inside it — two springs on nested elements, the outer one carrying six
   * cards while popLayout has both days mounted. That is why a swipe felt worse
   * than tapping a day that plays the identical transition.
   *
   * When it was a swipe the day stops sliding and lets the strip carry the
   * horizontal movement, so there is one spring on one element and the gesture
   * resolves into the transition instead of racing it.
   *
   * Owned here rather than inside useDaySwipe because clearing it belongs to
   * every day change, and a day-bar tap never reaches that hook.
   */
  const [fromSwipe, setFromSwipe] = useState(false);
  const markSwipe = useCallback(() => setFromSwipe(true), []);

  const handleDaySelect = useCallback((i: number) => {
    setSelectedDay(prev => (i === prev ? prev : i));
    // replaceState, as before: tapping through the weekdays must not stack
    // history entries, or Back walks Friday -> Thursday instead of leaving the
    // app. setSearchParam rewrites this one key and leaves the rest of the
    // query string alone, which is what the old spread of `prev` did.
    setSearchParam("day", DAY_KEYS[i]);
  }, []);

  // Initial data loading + localStorage cleanup
  useEffect(() => {
    cleanupLocalStorage();
    // Menu, origins, descriptions arrive as props from the server component
    // (loaded directly from Supabase). No fetch waterfall on initial paint.
    setMounted(true);
  }, []);

  // Refresh date-derived state on visibility change + every 5 minutes.
  // Handles the Sun→Mon midnight transition and long-open sessions.
  useEffect(() => {
    const bump = () => setDateTick(t => t + 1);
    const onVisibility = () => {
      if (!document.hidden) bump();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const interval = setInterval(bump, 5 * 60 * 1000);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(interval);
    };
  }, []);

  // Single source of truth for which week to render and the mode that
  // drives header copy / banner / vote gating. Lives above the keyboard
  // effect so its dep array can reference todayIndex.
  const sortedCanteens = useMemo(() => {
    if (!menuData) return [];
    return CANTEEN_ORDER
      .filter(name => menuData.canteens[name])
      .map(name => [name, menuData.canteens[name]] as [string, CanteenData]);
  }, [menuData]);

  const canteenWeekNumbers = useMemo(
    () => sortedCanteens
      .map(([, c]) => parseCanteenWeekNumber(c.week))
      .filter((n): n is number => n !== null),
    [sortedCanteens],
  );

  // dateTick forces a recompute on visibility/interval so Sun→Mon transitions
  // cleanly; it is deliberately a dep the callback never reads, which is what
  // the disable below is for. `servedWeekId` is read and so must be listed —
  // leaving it out pins the header to whatever week the first payload named.
  const displayContext = useMemo(
    () => computeDisplayContext(canteenWeekNumbers, searchParams.week, servedWeekId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canteenWeekNumbers, dateTick, searchParams.week, servedWeekId],
  );

  const { mode, weekNumber: displayWeek, todayIndex, anchor: displayMonday } = displayContext;

  // Seed selectedDay once menu data is ready, so the user lands on the
  // mode-appropriate day (today / Monday-preview / Friday-recap).
  //
  // Unless the URL asked for a day. This used to seed unconditionally, which
  // quietly undid `?day=`: the initial state reads it and the effect above
  // re-applies it, and then this fired as soon as the menu arrived and put the
  // default back. The app writes `?day=` into the URL on every day change, so
  // every link anyone shared opened on today instead of the day they were
  // looking at.
  const seededSelectedDayRef = useRef(false);
  useEffect(() => {
    if (!menuData || seededSelectedDayRef.current) return;
    seededSelectedDayRef.current = true;

    const requested = searchParams?.day
      ? DAY_KEYS.indexOf(searchParams.day.toLowerCase() as (typeof DAY_KEYS)[number])
      : -1;
    if (requested >= 0) return;

    setSelectedDay(displayContext.defaultSelectedDay);
  }, [menuData, displayContext.defaultSelectedDay, searchParams?.day]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      const isInput = tag === "input" || tag === "textarea" || tag === "select";

      if (e.key === "Escape") {
        if (infoOpen) {
          setInfoOpen(false);
        } else if (menyView.isOpen) {
          closeMeny();
        } else if (dealsView.isOpen) {
          closeDeals();
        } else if (weekOverviewOpen) {
          setWeekOverviewOpen(false);
        } else if (leaderboardOpen) {
          setLeaderboardOpen(false);
        } else {
          setLightboxIndex(-1);
          setActionSheet({ isOpen: false, canteenName: "", dishName: "", imagePath: "", description: null });
          closeRecipe();
        }
      } else if (e.key === "ArrowLeft" && !isInput) {
        if (selectedDay > 0 && !anyOverlayOpen) {
          handleDaySelect(selectedDay - 1);
        }
      } else if (e.key === "ArrowRight" && !isInput) {
        if (selectedDay < 4 && !anyOverlayOpen) {
          handleDaySelect(selectedDay + 1);
        }
      } else if (e.key === " " && !isInput) {
        if (!anyOverlayOpen) {
          e.preventDefault();
          handleDaySelect(todayIndex >= 0 ? todayIndex : 0);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedDay, todayIndex, anyOverlayOpen, lightboxIndex, actionSheet.isOpen, recipeModal.isOpen, dealsView.isOpen, menyView.isOpen, weekOverviewOpen, leaderboardOpen, infoOpen, handleDaySelect, closeDeals, closeMeny, closeRecipe]);

  // On-demand image preloader for other days — warms a day when hovered or touched
  const preloadDay = useCallback((dayIdx: number) => {
    const dk = DAY_KEYS[dayIdx];
    if (!dk) return;
    CANTEEN_ORDER.forEach(name => {
      const plateImage = plateImages[`${dk}|${name}`];
      if (!plateImage) return;
      const src = getSupabaseImageUrl("images_nobg", plateImage, { width: plateWidth, format: "webp", quality: 75 });

      if (preloadedRef.current.has(src)) return;
      preloadedRef.current.add(src);
      const img = new window.Image();
      img.onload = () => markImageCached(src);
      img.src = src;
    });
  }, [plateImages, plateWidth]);

  // Finger and trackpad -> day change. Extracted whole: the axis lock, the
  // MotionValue the strip rides on, the non-passive listener and the release
  // threshold are one mechanism, and every bug here came from moving one
  // without the others.
  const { trackRef, handleWheel, handleTouchStart, handleTouchEnd } = useDaySwipe({
    scrollRef,
    selectedDay,
    onSelectDay: handleDaySelect,
    blocked: anyOverlayOpen,
    ready: menuData !== null,
    markSwipe,
  });

  const fullDayLabels = FULL_DAYS_NO;

  const maxVotes = useMemo(() => Math.max(0, ...sortedCanteens.map(([name]) => voting.votes[name] ?? 0)), [sortedCanteens, voting.votes]);

  // Shared with LoadingScreen so the shell shown while the menu loads and the
  // header that replaces it cannot print different dates for the same week.
  const { dateStr, dayLabelsData } = useMemo(() => ({
    dateStr: formatLongDate(displayMonday, selectedDay, "no"),
    dayLabelsData: weekDayLabels(displayMonday),
  }), [selectedDay, displayMonday]);

  const allDaysData = useMemo((): CanteenDayItem[][] => {
    return DAY_KEYS.map(dk => {
      return sortedCanteens.map(([canteenName, canteen]) => {
        const dayEntry = canteen.menu.find(d => d.day.toLowerCase() === dk);
        const noItems = dayEntry?.no?.items;
        const enItems = dayEntry?.en?.items;
        const rawItems = (noItems && noItems.length > 0 ? noItems : enItems);
        const items = getRankedItems(rawItems, canteenName);
        const mainDish = items?.find(i => i.isMain && i.dish.trim());
        // Defense in depth: drop items whose `dish` field is empty (older
        // weekly_menus rows have empty entries from a scraper bug fixed in
        // a later commit; new rows shouldn't ever land here).
        const displaySideDishes = items?.filter(i => !i.isMain && i.dish.trim()).slice(0, 3) || [];
        // Rank the Norwegian list with the SAME function rather than trusting
        // the stored `isMain` flag. Rows written by an earlier version of the
        // ranking disagree with today's, and reading the flag straight from
        // the database attached the wrong dish's allergens to the card.
        const noRanked = getRankedItems(noItems, canteenName);
        const noMainDish = noRanked.find(i => i.isMain && i.dish.trim());
        const noSideDishes = noRanked.filter(i => !i.isMain && i.dish.trim());
        const mainAllergens = noMainDish?.allergens || mainDish?.allergens || [];
        const sideDishes = displaySideDishes.map((item, idx) => ({
          ...item,
          allergens: noSideDishes[idx]?.allergens || item.allergens,
        }));
        const imageSlug = CANTEEN_IMAGE_SLUGS[canteenName] || canteenName.toLowerCase().replace(/\s+/g, "_");

        // Closed canteens point at one of 3 static cutlery-and-napkin plates
        // hosted in Supabase. We don't generate dish images for closed days,
        // so without this branch the slot URL would resolve to a stale image
        // from whenever the canteen was last open on this weekday.
        const isClosed = !mainDish || ["stengt", "closed", "lukket"].some(kw => mainDish.dish.toLowerCase().includes(kw));

        // The server resolves which stored plate belongs to this card; an absent
        // entry means no picture exists for this dish yet, and the card's
        // onError placeholder is the honest answer. Lightbox uses the
        // untransformed transparent PNG so the food sits on the warm gradient
        // backdrop instead of the studio dark-grey from the bg version.
        const plateImage = plateImages[`${dk}|${canteenName}`];
        const imagePath = isClosed
          ? getClosedPlateUrl(`${canteenName}-${dk}`, { width: plateWidth, format: "webp", quality: 75 })
          : plateImage
            ? getSupabaseImageUrl("images_nobg", plateImage, { width: plateWidth, format: "webp", quality: 75 })
            : "";
        // Sized, not untransformed. The bare URL serves the original PNG —
        // 1.66 MB for a picture no phone screen can show more than a fraction
        // of, downloaded the moment anyone taps a plate. 1080px WebP is wider
        // than the largest phone viewport and about 5% of the bytes, and the
        // transparency the gradient backdrop depends on survives it: WebP has
        // an alpha channel and `images_nobg` is the cut-out bucket.
        const highResImagePath = isClosed
          ? getClosedPlateUrl(`${canteenName}-${dk}`, { width: 1080, format: "webp", quality: 85 })
          : plateImage
            ? getSupabaseImageUrl("images_nobg", plateImage, { width: 1080, format: "webp", quality: 85 })
            : "";
        // CanteenDayItem models "no usable week label" as undefined, not null.
        const canteenWeekNum = parseCanteenWeekNumber(canteen.week) ?? undefined;
        const cmp = canteenWeekNum !== undefined ? compareWeeks(canteenWeekNum, displayWeek) : 0;
        const isOutdated = cmp === -1;
        const isAhead = cmp === 1;
        const enLookup = dayEntry?.en?.items || [];
        // Origin + description follow the kitchen's language (NO). The EN title
        // is a translation maintained by the canteen and occasionally points at
        // a completely different dish (e.g. NO "Svensk kjøttgrateng" vs.
        // EN "Braised chicken leg"). Trust NO for cross-references.
        const lookupMainDish =
          noMainDish ?? getRankedItems(enLookup, canteenName).find(i => i.isMain);
        const origin = dishOrigins[lookupMainDish?.dish || ""] ?? null;
        const descEntry = dishDescriptions[lookupMainDish?.dish || ""];
        const description = descEntry
          ? (typeof descEntry === "string" ? descEntry : descEntry["no"] || descEntry["en"] || null)
          : null;
        // Pull availability notes from the user's preferred language; fall back
        // to the other language if the canteen only published one side.
        const langNotes = dayEntry?.["no"]?.availabilityNotes;
        const otherNotes = dayEntry?.["en"]?.availabilityNotes;
        const availabilityNotes = (langNotes?.length ? langNotes : otherNotes) || [];
        // The headline the card prints. Keyed on the same NO lookup dish as the
        // origin and description above, for the same reason: the EN title the
        // canteen publishes sometimes names a different dish entirely.
        const displayDishName =
          dishShortNames[lookupMainDish?.dish || ""] || mainDish?.dish || null;
        return {
          canteenName, canteen, dayEntry, items, mainDish, sideDishes,
          mainAllergens, imageSlug, imagePath, highResImagePath,
          isOutdated, isAhead, canteenWeekNum, origin, description,
          displayDishName, availabilityNotes,
        };
      });
    });
  }, [sortedCanteens, dishOrigins, dishDescriptions, dishShortNames, displayWeek, plateImages, plateWidth]);

  const canteenDayData = useMemo(() => allDaysData[selectedDay] ?? [], [allDaysData, selectedDay]);
  const openCanteens = useMemo(() => canteenDayData.filter(c => !isCanteenClosed(c)), [canteenDayData]);
  const closedCanteens = useMemo(() => canteenDayData.filter(c => isCanteenClosed(c)), [canteenDayData]);

  // YOLO runner: triggered by tapping the Today button in the day bar. Cycles
  // a highlight only over canteens that are currently serving (open + not
  // outdated + not ahead-of-week), dimming the rest. Lands on a random one
  // after a ~5s decelerating sweep, scrolls it into view, then resets.
  // No audio.
  const runYolo = useCallback((dayIdx: number) => {
    if (yoloSpinning) return;

    // Use today's data directly so we don't race with `setSelectedDay` —
    // by the time the setTimeout chain fires React will have re-rendered
    // with selectedDay === dayIdx, and the cardIdx values match this array.
    // cardsForDay is the full canteen-ordered list (open + closed) since
    // closed canteens now render as their own ClosedCard in the same slots;
    // eligibility just excludes them from the sweep.
    const cardsForDay = allDaysData[dayIdx] ?? [];
    const eligibleIndices = cardsForDay
      .map((c, i) => (!isCanteenClosed(c) && !c.isOutdated && !c.isAhead) ? i : -1)
      .filter(i => i !== -1);

    if (eligibleIndices.length < 2) return;

    yoloTimersRef.current.forEach(clearTimeout);
    yoloTimersRef.current = [];

    setYoloSpinning(true);
    setYoloWinner(-1);
    setYoloHighlight(-1);

    const E = eligibleIndices.length;
    const targetPos = Math.floor(Math.random() * E);

    // Pick K so the LAST tick is at eligibleIndices[targetPos]:
    // sequence is eligibleIndices[0], [1], …, [E-1], [0], [1], … and we want
    // (K-1) % E === targetPos. Base K = ~24 ticks gives ~5s with 1.10 growth.
    let K = 24;
    while ((K - 1) % E !== targetPos) K++;

    let cumulative = 0;
    for (let step = 0; step < K; step++) {
      const interval = 60 * Math.pow(1.10, step);
      const delay = cumulative;
      const cardIdx = eligibleIndices[step % E];
      const isFinal = step === K - 1;

      const t = setTimeout(() => {
        setYoloHighlight(cardIdx);
        if (isFinal) {
          setYoloWinner(cardIdx);
          setYoloHighlight(-1);
          setYoloSpinning(false);

          const winnerName = cardsForDay[cardIdx]?.canteenName;
          if (winnerName) {
            const el = scrollRef.current?.querySelector<HTMLElement>(
              `[data-yolo-card-key="${CSS.escape(winnerName)}"]`
            );
            el?.scrollIntoView({ behavior: "smooth", block: "center" });

            fireConfetti({
              particleCount: 75,
              spread: 70,
              origin: { y: 0.65 },
              colors: ["#c8741a", "#e8a020", "#d9604a", "#4a9e55", "#fffaf0"],
              disableForReducedMotion: true,
            });

            showToast(
              "success",
              `🎲 YOLO valgte ${winnerName} for deg i dag!`,
              { duration: 4000 }
            );
          }
          // No auto-release. Winner state persists until the next YOLO spin
          // starts (which clears it at the top of runYolo) or selectedDay
          // changes (cleared by the effect below).
        }
      }, delay);
      yoloTimersRef.current.push(t);
      cumulative += interval;
    }
  }, [yoloSpinning, allDaysData]);

  // Clear the winner state when the user navigates to another day.
  useEffect(() => {
    setYoloWinner(-1);
    setYoloHighlight(-1);
  }, [selectedDay]);

  // Cleanup any in-flight YOLO timers on unmount.
  useEffect(() => () => {
    yoloTimersRef.current.forEach(clearTimeout);
    yoloTimersRef.current = [];
  }, []);

  // #6 — Lightbox image click handler using open canteen index
  const handleImageClick = useCallback((data: { canteenName: string }) => {
    const idx = openCanteens.findIndex(c => c.canteenName === data.canteenName);
    setLightboxIndex(idx >= 0 ? idx : 0);
  }, [openCanteens]);

  // Every viewport opens the action sheet. A previous revision sent desktop
  // clicks straight to the vote modal instead, which made "Lag hjemme" — and
  // the dish description, the share button and the recipe — unreachable with a
  // mouse, and made a click on a non-voteable day (any day that is not today)
  // do nothing at all. The sheet is the only route to those actions, so it has
  // to open regardless of width; voting is one of the buttons inside it.
  const handleCardClick = useCallback((canteenName: string) => {
    const data = canteenDayData.find(c => c.canteenName === canteenName);
    setActionSheet({
      isOpen: true,
      canteenName,
      dishName: data?.mainDish?.dish || "",
      imagePath: data?.imagePath || "",
      description: data?.description || null,
    });
  }, [canteenDayData]);

  const handleShareSlackWrapped = useCallback(() => {
    voting.handleShareSlack(canteenDayData);
  }, [voting, canteenDayData]);

  // `mounted` used to gate this too, which cost a painted frame of skeleton on
  // every load for no benefit: it is a leftover from when this was a Next.js
  // server component and the first client render had to match the server's.
  // There is no SSR any more — `menuData` arrives from the route loader before
  // this component exists — so the only thing left to wait for is the effect
  // flush, and waiting for it just showed the placeholder one frame longer.
  /*
    Derive the transition during render, not in an effect — an effect would
    start it one painted frame late, so the new day would be visible at rest
    before it slid. This is React's sanctioned derived-state escape hatch: the
    guard makes the re-render terminate, and every setter targets this
    component's own state.

    Gated on `menuData` because two effects move `selectedDay` while the menu
    is still loading (the `?day=` reader and the seed that picks the default
    day). `<AnimatePresence>` was not mounted during that phase, so those moves
    produced no transition; without the gate they would mount a whole second
    DayPanel — three FoodCards and their plates — for a day that has never been
    on screen, and the first frame the user sees would be it sliding away.

    `fromSwipe` is consumed here rather than in `handleDaySelect` because that
    is the only place it is read. It used to be cleared only on the tap path,
    so after any swipe it stayed true and the next day change arriving from the
    URL — a shared link, browser Back — was told it came from a finger and
    cross-faded in place with no slide and no strip movement to stand in.
  */
  if (current.day !== selectedDay) {
    if (!menuData) {
      // Keep the panels in step with the day, without producing a transition.
      setCurrent({ seq: 0, day: selectedDay });
    } else {
      const d = fromSwipe ? 0 : selectedDay > current.day ? 1 : -1;
      setDayDir(d);
      if (fromSwipe) setFromSwipe(false);
      setLeaving({ seq: current.seq, day: current.day, dir: d });
      setCurrent({ seq: current.seq + 1, day: selectedDay });
    }
  }

  if (!menuData) {
    return <LoadingScreen />;
  }

  const todayKey = getLocalDateKey();
  const alreadyShared = typeof window !== "undefined" && !!localStorage.getItem(`slack_shared_${todayKey}`);

  const ShareButton = ({ className }: { className?: string }) => (
    <button
      className={`share-btn${alreadyShared ? " disabled" : ""}${voting.shareState === "sent" ? " sent" : ""}${className ? ` ${className}` : ""}`}
      disabled={alreadyShared || voting.shareState === "loading"}
      onClick={handleShareSlackWrapped}
      title={alreadyShared ? ("Allerede delt i dag") : undefined}
    >
      {voting.shareState === "sent"
        ? ("Sendt! \u2713")
        : voting.shareState === "loading"
        ? "..."
        : (
          <>
            <Share2 size={14} style={{ marginRight: 6 }} />
            {"Del resultater"}
          </>
        )
      }
    </button>
  );

  return (
    <div className="app-wrapper">
      <AppHeader
        mode={mode}
        displayWeek={displayWeek}
        dayLabel={fullDayLabels[selectedDay]}
        dateStr={dateStr}
        actions={{
          onInfo: () => setInfoOpen(true),
          onLeaderboard: () => setLeaderboardOpen(true),
          onWeekOverview: () => setWeekOverviewOpen(true),
        }}
      >
        {/* Closed canteens pill — inside header row on desktop, fixed banner on mobile */}
        {closedCanteens.length > 0 && openCanteens.length > 0 && (
          <ClosedCanteensPill closedCanteens={closedCanteens} />
        )}
      </AppHeader>

      {/* Cards */}
      <main
        className="cards-container"
        ref={scrollRef}
        onScroll={handleScroll}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <ErrorBoundary>
          <div className="cards-track" ref={trackRef}>
            {/*
              The day change: at most two panels, stacked in this element's
              single grid cell. `<AnimatePresence mode="popLayout">` used to do
              this by pinning the outgoing day with `position: absolute` and a
              measured top/left; the grid stack the stylesheet already declares
              does it with no positioning at all, which is both simpler and
              free of popLayout's desktop failure mode (the pinned offsets
              resolve against the stretched grid AREA, not the box the panel
              was standing in).

              The leaving panel is rendered FIRST, and that ordering is
              load-bearing: it means React appends the arriving panel rather
              than inserting before it, and `insertBefore` would take the
              leaving node out of the tree and cancel its running transition.
            */}
            {leaving && (
              <DayPanel
                key={leaving.seq}
                day={leaving.day}
                data={allDaysData[leaving.day] ?? []}
                phase="exit"
                dir={leaving.dir}
                todayIndex={todayIndex}
                votes={voting.votes}
                maxVotes={maxVotes}
                onImageClick={handleImageClick}
                onCardClick={handleCardClick}
                /* Forced off: tapping Today both starts the YOLO spin and
                   changes the day, and the glow belongs to the day arriving,
                   not the one leaving. AnimatePresence hid this by freezing the
                   exiting child's props; this panel renders live. */
                yoloHighlight={-1}
                yoloWinner={-1}
                onExited={() =>
                  setLeaving(l => (l && l.seq === leaving.seq ? null : l))
                }
              />
            )}
            <DayPanel
              key={current.seq}
              day={current.day}
              data={canteenDayData}
              phase={current.seq === 0 ? "static" : "enter"}
              dir={dayDir}
              todayIndex={todayIndex}
              votes={voting.votes}
              maxVotes={maxVotes}
              onImageClick={handleImageClick}
              onCardClick={handleCardClick}
              yoloHighlight={yoloHighlight}
              yoloWinner={yoloWinner}
            />
          </div>
        </ErrorBoundary>
      </main>

      {/* Day Selector — tapping the Today button also fires the YOLO
          randomiser via onTodayPress. */}
      <DaySelector
        fullDayLabels={fullDayLabels}
        dayLabelsData={dayLabelsData}
        selectedDay={selectedDay}
        todayIndex={todayIndex}
        mode={mode}
        onDaySelect={handleDaySelect}
        onDayHover={preloadDay}
        onTodayPress={mode === "weekday-current" ? () => runYolo(todayIndex) : undefined}
        cardsRef={scrollRef}
      />

      {/* Lazy: ~80 lines of static JSX and two inline SVGs for a panel almost
          nobody opens, plus its stylesheet. */}
      {infoOpen && (
        <Suspense fallback={null}>
          <InfoModal onClose={() => setInfoOpen(false)} />
        </Suspense>
      )}

        {leaderboardOpen && (
          <Suspense fallback={null}>
            <LeaderboardModal
              isOpen={leaderboardOpen}
              onClose={() => setLeaderboardOpen(false)}
            />
          </Suspense>
        )}

        {weekOverviewOpen && (
          <Suspense fallback={null}>
            <WeekOverview
              allDaysData={allDaysData}
              selectedDay={selectedDay}
              todayIndex={todayIndex}
              dayLabelsData={dayLabelsData}
              fullDayLabels={fullDayLabels}
              onDaySelect={(i) => { handleDaySelect(i); setWeekOverviewOpen(false); }}
              onClose={() => setWeekOverviewOpen(false)}
            />
          </Suspense>
        )}




      {/*
        Action sheet, with the 120Hz native GPU compositor transform.

        Not mobile-only. A width check used to stand here as well as in
        handleCardClick, so on a desktop the sheet was unreachable twice over
        and "Lag hjemme", the dish description, the share button and the recipe
        had no route at all — a click on a card either opened the vote modal or,
        on any day that was not today, did nothing. Every `.action-sheet` rule
        is top-level (globals.css:3184+), capped at 440px and anchored to the
        bottom, so it is already dressed for a wide window.
      */}
      {(() => {
        // Stays mounted once it has been opened, rather than unmounting the
        // moment `isOpen` goes false.
        //
        // ui/sheet.tsx has a proper two-phase close — it drops `shown`, lets the
        // 400ms translateY run, and only then unmounts — but it never got to
        // use it: returning null here destroyed the whole component on the same
        // tick, so the sheet vanished instead of sliding down. Keeping it
        // mounted hands the close animation back to the thing that owns it.
        //
        // The latch is what keeps it lazy. The chunk is still not fetched until
        // the first tap; afterwards the component stays mounted and renders
        // nothing while closed, which costs one null render.
        if (actionSheet.isOpen) sheetEverOpened.current = true;
        if (!sheetEverOpened.current) return null;

        const closeSheet = () => {
          // Only the flag. Wiping the canteen and dish here used to be
          // invisible because the component was destroyed in the same tick —
          // now that it survives to animate out, clearing them would empty the
          // sheet's content mid-slide. The next open overwrites them anyway.
          setActionSheet((s) => ({ ...s, isOpen: false }));
          voting.setVoteSuccess(false);
          voting.setShareState("idle");
        };
        const sheetCanteen = canteenDayData.find(c => c.canteenName === actionSheet.canteenName);
        const canVote = mode === "weekday-current" && selectedDay === todayIndex && sheetCanteen && !sheetCanteen.isOutdated && !sheetCanteen.isAhead;

        return (
          <Suspense fallback={null}>
          <ActionSheet
            isOpen={actionSheet.isOpen}
            canteenName={actionSheet.canteenName}
            dishName={actionSheet.dishName}
            imagePath={actionSheet.imagePath}
            description={actionSheet.description}
            canVote={!!canVote}
            hasVoted={voting.hasVoted}
            isVoting={voting.isVoting}
            votedCanteen={voting.votedCanteen}
            voteSuccess={voting.voteSuccess}
            onVote={voting.handleVote}
            onRecipeClick={handleRecipeClick}
            onClose={closeSheet}
            shareButton={<ShareButton />}
          />
          </Suspense>
        );
      })()}

      {/* Lightbox with canteen swipe */}
        {lightboxIndex >= 0 && (
          <Suspense fallback={null}>
            <Lightbox
              isOpen={lightboxIndex >= 0}
              currentIndex={lightboxIndex}
              canteenDayData={openCanteens}
              onClose={() => setLightboxIndex(-1)}
              onNavigate={setLightboxIndex}
            />
          </Suspense>
        )}

      {/* The recipe panel and the Meny/Deals views over it, in their own chunk.
          It is reached by two taps and brings `@/lib/ingredientImg` with it —
          6.6 KB imported nowhere else — so none of it belongs in the chunk the
          first paint waits on. */}
      {recipeModal.isOpen && (
        <Suspense fallback={null}>
          <RecipeModal
            recipeModal={recipeModal}
            recipeServings={recipeServings}
            setRecipeServings={setRecipeServings}
            menyView={menyView}
            dealsView={dealsView}
            handleRecipeClick={handleRecipeClick}
            handleMenyClick={handleMenyClick}
            handleDealsClick={handleDealsClick}
            closeRecipe={closeRecipe}
            closeMeny={closeMeny}
            closeDeals={closeDeals}
          />
        </Suspense>
      )}
    </div>
  );
}
