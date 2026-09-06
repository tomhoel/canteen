"use client";

import { useState, useEffect, useMemo, useRef, useCallback, lazy, Suspense } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useSearch, useNavigate } from "@tanstack/react-router";
import { fireConfetti, showToast } from "@/lib/lazy-effects";
import { markImageCached } from "@/lib/imageCache";
import { Share2 } from "lucide-react";
import { FULL_DAYS_NO, DAY_KEYS, CANTEEN_ORDER, CANTEEN_IMAGE_SLUGS, getSupabaseImageUrl, getClosedPlateUrl, PLATE_CARD_WIDTH } from "@/lib/constants";
import type { MenuData, CanteenData, CanteenDayItem, DishOrigin, DishDescription } from "@/lib/types";
import { getMealDbUrl, getSpoonUrl, getLetterFallback } from "@/lib/ingredientImg";
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
import FoodCard from "@/components/FoodCard";
import ClosedCanteensPill from "@/components/ClosedCanteensPill";
import AllClosedCard from "@/components/AllClosedCard";
import ClosedCard from "@/components/ClosedCard";
import ActionSheet from "@/components/ActionSheet";
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
const DealsView = lazy(() => import("@/components/DealsView"));
const MenyView = lazy(() => import("@/components/MenyView"));
const Lightbox = lazy(() => import("@/components/Lightbox"));
const LeaderboardModal = lazy(() => import("@/components/LeaderboardModal"));
const WeekOverview = lazy(() => import("@/components/WeekOverview"));

export interface HomeClientProps {
  initialMenu: MenuData | null;
  /** The week the server actually served, so the header cannot label it wrong. */
  servedWeekId: string;
  initialOrigins: Record<string, DishOrigin>;
  initialDescriptions: Record<string, DishDescription>;
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


/** What the day transition needs, delivered via AnimatePresence custom. */
type DayCustom = { dir: number; fromSwipe: boolean };

export default function HomeClient({ initialMenu, servedWeekId, initialOrigins, initialDescriptions, plateImages }: HomeClientProps) {
  const navigate = useNavigate({ from: "/" });
  const searchParams = useSearch({ strict: false }) as { day?: string; week?: string };

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
  // How far a day slides in from. The desktop has three cards across a wide
  // viewport and can afford the full throw; a phone card is nearly the
  // screen, so the same 80px reads as the whole layout lurching.
  const travel = isDesktop ? 80 : 44;
  const [lightboxIndex, setLightboxIndex] = useState(-1);
  const [mounted, setMounted] = useState(false);
  // Bumped on visibilitychange + every 5 min to refresh date logic without reload.
  const [dateTick, setDateTick] = useState(0);
  const [actionSheet, setActionSheet] = useState<{ isOpen: boolean; canteenName: string; dishName: string; imagePath: string; description: string | null }>({ isOpen: false, canteenName: "", dishName: "", imagePath: "", description: null });
  const [dishOrigins, setDishOrigins] = useState<Record<string, DishOrigin>>(initialOrigins);
  const [dishDescriptions, setDishDescriptions] = useState<Record<string, DishDescription>>(initialDescriptions);

  useEffect(() => {
    setMenuData(initialMenu);
    setDishOrigins(initialOrigins);
    setDishDescriptions(initialDescriptions);
  }, [initialMenu, initialOrigins, initialDescriptions]);
  const [direction, setDirection] = useState(0);
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
    // Cleared for every day change; the swipe path sets it again immediately
    // after calling this, and the later write wins within the same batch.
    setFromSwipe(false);
    setSelectedDay(prev => {
      if (i === prev) return prev;
      setDirection(i > prev ? 1 : -1);
      return i;
    });
    navigate({
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        day: DAY_KEYS[i],
      }),
      replace: true,
    });
  }, [navigate]);

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
  const { dragX, handleWheel, handleTouchStart, handleTouchEnd } = useDaySwipe({
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
        return {
          canteenName, canteen, dayEntry, items, mainDish, sideDishes,
          mainAllergens, imageSlug, imagePath, highResImagePath,
          isOutdated, isAhead, canteenWeekNum, origin, description,
          availabilityNotes,
        };
      });
    });
  }, [sortedCanteens, dishOrigins, dishDescriptions, displayWeek, plateImages, plateWidth]);

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
          <motion.div className="cards-track" style={{ x: dragX }}>
            {/*
              Day switch.

              `popLayout`, not `wait`. With `wait` the outgoing day has to
              finish leaving before the incoming one may start, so the two
              never share the screen and the change reads as two separate
              events — which is what made it feel stiff and rigid. popLayout
              takes the exiting day out of layout flow so both move at once and
              the days cross through each other.

              The spring is what gives it weight: a fixed-duration tween
              arrives at the same instant however hard the strip was flicked,
              and has no relationship to the gesture that caused it.

              `scale` is desktop-only, and that is the one real concession.
              Scaling a box full of text forces WebKit to re-rasterise every
              glyph in it on each frame, which is exactly the cost a phone
              cannot absorb — it is why the scale was stripped out in the first
              place. The phone keeps the overlap, the spring and the slide, and
              travels a little less far because it has less room to travel in.
            */}
            <AnimatePresence mode="popLayout" initial={false} custom={{ dir: direction, fromSwipe }}>
              <motion.div
                key={selectedDay}
                custom={{ dir: direction, fromSwipe }}
                variants={{
                  enter: ({ dir, fromSwipe }: DayCustom) => ({
                    // A swipe leaves the horizontal movement to the strip.
                    x: fromSwipe ? 0 : dir > 0 ? travel : dir < 0 ? -travel : 0,
                    opacity: 0,
                    ...(isDesktop ? { scale: 0.98 } : {}),
                  }),
                  center: {
                    x: 0,
                    opacity: 1,
                    ...(isDesktop ? { scale: 1 } : {}),
                    transition: {
                      x: { type: "spring", stiffness: 300, damping: 30, mass: 0.8 },
                      opacity: { duration: isDesktop ? 0.28 : 0.24 },
                      scale: { duration: 0.28 },
                    },
                  },
                  exit: ({ dir, fromSwipe }: DayCustom) => ({
                    x: fromSwipe ? 0 : dir > 0 ? -travel : travel,
                    opacity: 0,
                    ...(isDesktop ? { scale: 0.98 } : {}),
                    transition: {
                      x: { type: "spring", stiffness: 300, damping: 30, mass: 0.8 },
                      opacity: { duration: isDesktop ? 0.2 : 0.18 },
                      scale: { duration: 0.2 },
                    },
                  }),
                }}
                initial="enter"
                animate="center"
                exit="exit"
                className="cards-animated-wrapper"
              >
                {openCanteens.length === 0 ? (
                  <AllClosedCard closedCanteens={closedCanteens} />
                ) : (
                  <>
                    {closedCanteens.length > 0 && (
                      <div className="closed-pill-mobile">
                        <ClosedCanteensPill closedCanteens={closedCanteens} />
                      </div>
                    )}
                    {canteenDayData.map((data, cardIdx) => (
                      isCanteenClosed(data) ? (
                        <ClosedCard
                          key={data.canteenName}
                          data={data}
                          cardIdx={cardIdx}
                        />
                      ) : (
                        <FoodCard
                          key={data.canteenName}
                          data={data}
                          cardIdx={cardIdx}
                          selectedDay={selectedDay}
                          todayIndex={todayIndex}
                          voteCount={voting.votes[data.canteenName] ?? 0}
                          maxVotes={maxVotes}
                          onImageClick={handleImageClick}
                          onCardClick={handleCardClick}
                          yoloHighlighted={yoloHighlight === cardIdx}
                          yoloWinner={yoloWinner === cardIdx}
                        />
                      )
                    ))}
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          </motion.div>
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

      {/* Info Modal */}
      <AnimatePresence>
        {infoOpen && (
          <motion.div
            key="info-overlay"
            className="info-overlay"
            role="presentation"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setInfoOpen(false)}
          >
            <motion.div
              key="info-modal"
              className="info-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="info-title-id"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              transition={{ type: "spring", damping: 28, stiffness: 340 }}
              onClick={e => e.stopPropagation()}
            >
              <button className="info-close" onClick={() => setInfoOpen(false)} aria-label="Lukk">&times;</button>
              <div className="info-header">
                <h2 id="info-title-id" className="info-title">{"Dagens"} <span>{"Lunsj"}</span></h2>
                <p className="info-tagline">{"Din daglige lunsjfølgesvenn på Fornebu"}</p>
              </div>
              <div className="info-body">
                <p className="info-intro">
                  {"En alt-i-ett lunsjapp som henter ferske menyer fra kantinene på Telenor Fornebu hver uke. Se hva som serveres, stem på favorittlunsjen din, og oppdag nye oppskrifter — alt på ett sted."}
                </p>
                <div className="info-features">
                  <div className="info-feature">
                    <span className="info-feature-icon">&#x1F37D;&#xFE0F;</span>
                    <div>
                      <strong>{"Daglige menyer"}</strong>
                      <span>{"Tre kantiner, fem dager, komplett med allergener og bilder generert av AI."}</span>
                    </div>
                  </div>
                  <div className="info-feature">
                    <span className="info-feature-icon">&#x1F5F3;&#xFE0F;</span>
                    <div>
                      <strong>{"Stem i dag"}</strong>
                      <span>{"Se hvilken kantine kollegene dine velger. Stemmetall oppdateres i sanntid."}</span>
                    </div>
                  </div>
                  <div className="info-feature">
                    <span className="info-feature-icon">&#x1F468;&#x200D;&#x1F373;</span>
                    <div>
                      <strong>{"AI-oppskrifter"}</strong>
                      <span>{"Liker du retten? Få en komplett oppskrift med ingredienser, steg og koketips, laget av AI."}</span>
                    </div>
                  </div>
                  <div className="info-feature">
                    <span className="info-feature-icon">&#x1F6D2;</span>
                    <div>
                      <strong>{"Handle smart"}</strong>
                      <span>{"Finn de billigste ingrediensene på tvers av norske dagligvarebutikker, eller bygg en handleliste på MENY."}</span>
                    </div>
                  </div>
                  <div className="info-feature">
                    <span className="info-feature-icon">&#x1F310;</span>
                    <div>
                      <strong>{"Tospråklig"}</strong>
                      <span>{"Full norsk og engelsk støtte — bytt med en knapp."}</span>
                    </div>
                  </div>
                </div>
                <div className="info-tech">
                  <p className="info-tech-label">{"Bygget med"}</p>
                  <p className="info-tech-stack">Next.js &middot; React 19 &middot; Gemini AI &middot; Upstash Redis &middot; Vercel</p>
                </div>
              </div>
              <div className="info-footer">
                <span className="info-made-by">{"Laget av"} Tom Hoel</span>
                <div className="info-footer-links">
                  <a href="mailto:tom.chamkrai.hoel@telenor.no?subject=Feedback%20on%20Canteen%20App" className="info-footer-link">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                    {"Tilbakemelding"}
                  </a>
                  <a href="https://www.linkedin.com/in/tom-hoel-47923215b/" target="_blank" rel="noopener noreferrer" className="info-footer-link info-linkedin">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                    LinkedIn
                  </a>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {leaderboardOpen && (
          <Suspense fallback={null}>
            <LeaderboardModal
              isOpen={leaderboardOpen}
              onClose={() => setLeaderboardOpen(false)}
            />
          </Suspense>
        )}
      </AnimatePresence>

      <AnimatePresence>
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
      </AnimatePresence>




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
        if (!actionSheet.isOpen) return null;

        const closeSheet = () => {
          setActionSheet({ isOpen: false, canteenName: "", dishName: "", imagePath: "", description: null });
          voting.setVoteSuccess(false);
          voting.setShareState("idle");
        };
        const sheetCanteen = canteenDayData.find(c => c.canteenName === actionSheet.canteenName);
        const canVote = mode === "weekday-current" && selectedDay === todayIndex && sheetCanteen && !sheetCanteen.isOutdated && !sheetCanteen.isAhead;

        return (
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
        );
      })()}

      {/* Lightbox with canteen swipe */}
      <AnimatePresence>
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
      </AnimatePresence>

      {/* Recipe Modal */}
      <AnimatePresence>
        {recipeModal.isOpen && (
          <motion.div
            key="recipe-overlay"
            className="recipe-overlay"
            role="presentation"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => { closeRecipe(); closeDeals(); closeMeny(); }}
          >
            <motion.div
              key="recipe-modal"
              className="recipe-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="recipe-dish-title"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              transition={{ type: "spring", damping: 28, stiffness: 340 }}
              onClick={e => e.stopPropagation()}
            >
              <button className="recipe-close" onClick={() => { closeRecipe(); closeDeals(); closeMeny(); }} aria-label="Lukk">&#xD7;</button>

{menyView.isOpen ? (
              <>
                <div className="recipe-header">
                  <span className="recipe-canteen">{recipeModal.canteenName}</span>
                  <h2 className="recipe-dish-name">{recipeModal.dishName}</h2>
                </div>

                {menyView.isLoading && (
                  <div className="recipe-loading">
                    <span className="recipe-loading-emoji meny-loading-bag">{"\uD83D\uDECD\uFE0F"}</span>
                    <span className="recipe-loading-text">{"S\u00F8ker hos Meny..."}</span>
                  </div>
                )}

                {menyView.error && (
                  <div className="recipe-error">
                    <p>{menyView.error}</p>
                    <button className="recipe-retry-btn" onClick={() => recipeModal.recipe && handleMenyClick(recipeModal.dishName, recipeModal.recipe)}>
                      {"Pr\u00F8v igjen"}
                    </button>
                  </div>
                )}

                {menyView.data && (
                  <Suspense fallback={null}>
                    <MenyView
                      meny={menyView.data}
                      onBack={closeMeny}
                    />
                  </Suspense>
                )}
              </>
            ) : dealsView.isOpen ? (
              <>
                <div className="recipe-header">
                  <span className="recipe-canteen">{recipeModal.canteenName}</span>
                  <h2 className="recipe-dish-name">{recipeModal.dishName}</h2>
                </div>

                {dealsView.isLoading && !dealsView.deals && (
                  <div className="recipe-loading">
                    <span className="recipe-loading-emoji deals-loading-cart">{"\uD83D\uDED2"}</span>
                    <span className="recipe-loading-text">{"Sammenligner priser..."}</span>
                  </div>
                )}

                {dealsView.error && (
                  <div className="recipe-error">
                    <p>{dealsView.error}</p>
                    <button className="recipe-retry-btn" onClick={() => recipeModal.recipe && handleDealsClick(recipeModal.dishName, recipeModal.recipe)}>
                      {"Pr\u00F8v igjen"}
                    </button>
                  </div>
                )}

                {dealsView.deals && (
                  <Suspense fallback={null}>
                    <DealsView
                      deals={dealsView.deals}
                      isStreaming={dealsView.isStreaming}
                      onBack={closeDeals}
                    />
                  </Suspense>
                )}
              </>
            ) : (
              <>
                <div className="recipe-header">
                  <span className="recipe-canteen">{recipeModal.canteenName}</span>
                  <h2 className="recipe-dish-name">{recipeModal.dishName}</h2>
                </div>

                {recipeModal.isLoading && (
                  <div className="recipe-loading">
                    <span className="recipe-loading-emoji">&#x1F373;</span>
                    <span className="recipe-loading-text">{"Genererer oppskrift..."}</span>
                  </div>
                )}

                {recipeModal.error && (
                  <div className="recipe-error">
                    <p>{recipeModal.error}</p>
                    <button className="recipe-retry-btn" onClick={() => handleRecipeClick(recipeModal.dishName, recipeModal.canteenName)}>
                      {"Pr\u00F8v igjen"}
                    </button>
                  </div>
                )}

                {recipeModal.recipe && (() => {
                  const scale = recipeServings / recipeModal.recipe.servings;
                  const scaleAmount = (amount: string) => {
                    const num = parseFloat(amount);
                    if (isNaN(num)) return amount;
                    const scaled = num * scale;
                    return scaled % 1 === 0 ? scaled.toString() : scaled.toFixed(1).replace(/\.0$/, "");
                  };
                  const recipe = recipeModal.recipe;
                  return (
                  <>
                    <div className="recipe-meta">
                      <span className="recipe-meta-servings">
                        <button className="recipe-servings-btn" onClick={() => setRecipeServings(s => Math.max(1, s - 1))}>&#x2212;</button>
                        <span className="recipe-servings-value">{recipeServings}</span>
                        <button className="recipe-servings-btn" onClick={() => setRecipeServings(s => Math.min(20, s + 1))}>+</button>
                        <span className="recipe-servings-label">{"pers."}</span>
                      </span>
                      <span>{"Prep"}: {recipe.prepTime}</span>
                      <span>{"Tilbereding"}: {recipe.cookTime}</span>
                    </div>
                    <div className="recipe-content">
                      <div className="recipe-ingredients">
                        <h3 className="recipe-section-title">{"Ingredienser"}{scale !== 1 ? ` (${"\u00D7"}${scale % 1 === 0 ? scale : scale.toFixed(1)})` : ""}</h3>
                        <ul className="recipe-ingredient-list">
                          {recipe.ingredients.map((ing, i) => {
                            const fb = getLetterFallback(ing.item);
                            return (
                            <li key={i} className="recipe-ingredient-item" style={{ animationDelay: `${i * 50}ms` }}>
                              <div className="recipe-ingredient-img-wrap">
                                <img
                                  src={getMealDbUrl(ing.item)}
                                  alt=""
                                  className="recipe-ingredient-img"
                                  loading="lazy"
                                  onLoad={e => { (e.target as HTMLImageElement).parentElement!.classList.add("has-img"); }}
                                  onError={e => {
                                    const img = e.target as HTMLImageElement;
                                    if (!img.dataset.fallback) {
                                      img.dataset.fallback = "1";
                                      img.src = getSpoonUrl(ing.item);
                                    } else {
                                      img.style.display = "none";
                                    }
                                  }}
                                />
                                <span className="recipe-ingredient-letter" style={{ background: fb.color }}>{fb.letter}</span>
                              </div>
                              <div className="recipe-ingredient-details">
                                <span className="recipe-ingredient-name">{ing.itemLocal || ing.item}</span>
                                <span className="recipe-ingredient-amount">{scaleAmount(ing.amount)} {ing.unit}</span>
                              </div>
                            </li>
                            );
                          })}
                        </ul>
                        {/* Shopping divider + options */}
                        <div className="recipe-shop-divider" style={{ animationDelay: `${recipe.ingredients.length * 50 + 30}ms` }}>
                          <span className="shop-divider-label">{"Handle"}</span>
                        </div>
                        <div className="recipe-shop-row" style={{ animationDelay: `${recipe.ingredients.length * 50 + 50}ms` }}>
                          <button className="shop-card shop-card-meny" onClick={() => handleMenyClick(recipeModal.dishName, recipe)}>
                            <span className="shop-card-icon shop-icon-meny">
                              <span className="shop-icon-check" />
                            </span>
                            <span className="shop-card-text">
                              <span className="shop-card-label">{"Handleliste"}</span>
                              <span className="shop-card-sub">Meny</span>
                            </span>
                          </button>
                          <button className="shop-card shop-card-deals" onClick={() => handleDealsClick(recipeModal.dishName, recipe)}>
                            <span className="shop-card-icon shop-icon-deals">
                              <span className="shop-icon-tag" />
                            </span>
                            <span className="shop-card-text">
                              <span className="shop-card-label">{"Ukens tilbud"}</span>
                              <span className="shop-card-sub">{"Alle butikker"}</span>
                            </span>
                          </button>
                        </div>
                      </div>
                      <div className="recipe-steps">
                        <h3 className="recipe-section-title">{"Fremgangsm\u00E5te"}</h3>
                        <ol className="recipe-step-list">
                          {recipe.steps.map((step, i) => (
                            <li key={i} className="recipe-step-item" style={{ animationDelay: `${(i * 50) + 150}ms` }}>
                              <span className="recipe-step-number">{i + 1}</span>
                              <span className="recipe-step-text">{step}</span>
                            </li>
                          ))}
                        </ol>
                        {recipe.tip && (
                          <div className="recipe-tip">
                            <span className="recipe-tip-icon">&#x1F4A1;</span>
                            <span className="recipe-tip-text">{recipe.tip}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                  );
                })()}
              </>
            )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
      </AnimatePresence>
    </div>
  );
}
