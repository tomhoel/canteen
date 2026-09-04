"use client";

import { useState, useEffect, useMemo, useRef, useCallback, lazy, Suspense } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useSearch, useNavigate } from "@tanstack/react-router";
import { fireConfetti, showToast } from "@/lib/lazy-effects";
import { markImageCached } from "@/lib/imageCache";
import { Share2 } from "lucide-react";
import { FULL_DAYS_NO, FULL_DAYS_EN, DAY_KEYS, CANTEEN_ORDER, CANTEEN_IMAGE_SLUGS, getSupabaseImageUrl, getClosedPlateUrl } from "@/lib/constants";
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
import AppHeader from "@/components/AppHeader";
import DaySelector from "@/components/DaySelector";
import FoodCard from "@/components/FoodCard";
import ClosedCanteensPill from "@/components/ClosedCanteensPill";
import AllClosedCard from "@/components/AllClosedCard";
import ClosedCard from "@/components/ClosedCard";
import ActionSheet from "@/components/ActionSheet";
import { shouldTurnPage } from "@/lib/sheet-drag";
import { isCanteenClosed, getRankedItems } from "@/lib/canteen-utils";

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

/** Purge stale localStorage keys older than 7 days. */
function cleanupLocalStorage() {
  const PREFIXES = ["recipe_v4_", "deals_v4_", "meny_v4_"];
  const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();

  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (!key) continue;

    // Clean old voted_ and slack_shared_ keys (date-keyed)
    if (key.startsWith("voted_") || key.startsWith("slack_shared_")) {
      const dateStr = key.split("_").pop();
      if (dateStr && dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
        const age = now - new Date(dateStr + "T12:00:00").getTime();
        if (age > MAX_AGE) localStorage.removeItem(key);
      }
      continue;
    }

    // Clean old cached data by checking generatedAt or trying to parse
    if (PREFIXES.some(p => key.startsWith(p))) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (parsed.generatedAt) {
          const age = now - new Date(parsed.generatedAt).getTime();
          if (age > MAX_AGE) localStorage.removeItem(key);
        }
      } catch {
        localStorage.removeItem(key); // corrupt, remove
      }
    }
  }
}

export default function HomeClient({ initialMenu, initialOrigins, initialDescriptions, plateImages }: HomeClientProps) {
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
      searchParams?.week
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
  // Norwegian only, for now. The cascade animation and the switcher that drove
  // it were removed from the header at some point and the plumbing outlived
  // them: nothing could call setLang, so `lang` could never change and the
  // animation class could never be set. Both are in git if the switcher comes
  // back; leaving them here only made the language look configurable.
  const [lang] = useState<"no" | "en">("no");
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
  const { recipeModal, recipeServings, setRecipeServings, handleRecipeClick, closeRecipe } = useRecipe(lang);
  const { dealsView, handleDealsClick, closeDeals } = useDeals(lang);
  const { menyView, handleMenyClick, closeMeny } = useMenySearch(lang);

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

  const handleDaySelect = useCallback((i: number) => {
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

  // dateTick forces a recompute on visibility/interval so Sun→Mon transitions cleanly.
  const displayContext = useMemo(
    () => computeDisplayContext(canteenWeekNumbers, searchParams.week),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canteenWeekNumbers, dateTick, searchParams.week],
  );

  const { mode, weekNumber: displayWeek, todayIndex, anchor: displayMonday } = displayContext;

  // Canteens with nothing in the previewed week. They are absent from the row
  // rather than empty in it — the updater files each canteen under the week it
  // actually published — so without naming them, a kitchen that has not posted
  // next week's menu yet simply loses its card with no explanation. Only
  // meaningful in preview: on any other mode an absent canteen is a real fault.
  const pendingCanteens = useMemo(
    () =>
      mode === "weekend-preview" && menuData
        ? CANTEEN_ORDER.filter(name => !menuData.canteens[name])
        : [],
    [mode, menuData],
  );

  // Seed selectedDay once menu data is ready, so the user lands on the
  // mode-appropriate day (today / Monday-preview / Friday-recap).
  const seededSelectedDayRef = useRef(false);
  useEffect(() => {
    if (menuData && !seededSelectedDayRef.current) {
      setSelectedDay(displayContext.defaultSelectedDay);
      seededSelectedDayRef.current = true;
    }
  }, [menuData, displayContext.defaultSelectedDay]);

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
        if (selectedDay > 0 && lightboxIndex < 0 && !actionSheet.isOpen && !recipeModal.isOpen && !infoOpen) {
          handleDaySelect(selectedDay - 1);
        }
      } else if (e.key === "ArrowRight" && !isInput) {
        if (selectedDay < 4 && lightboxIndex < 0 && !actionSheet.isOpen && !recipeModal.isOpen && !infoOpen) {
          handleDaySelect(selectedDay + 1);
        }
      } else if (e.key === " " && !isInput) {
        if (lightboxIndex < 0 && !actionSheet.isOpen && !recipeModal.isOpen && !menyView.isOpen && !dealsView.isOpen && !weekOverviewOpen && !leaderboardOpen && !infoOpen) {
          e.preventDefault();
          handleDaySelect(todayIndex >= 0 ? todayIndex : 0);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedDay, todayIndex, lightboxIndex, actionSheet.isOpen, recipeModal.isOpen, dealsView.isOpen, menyView.isOpen, weekOverviewOpen, leaderboardOpen, infoOpen, handleDaySelect, closeDeals, closeMeny, closeRecipe]);

  // On-demand image preloader for other days — warms a day when hovered or touched
  const preloadDay = useCallback((dayIdx: number) => {
    const dk = DAY_KEYS[dayIdx];
    if (!dk) return;
    CANTEEN_ORDER.forEach(name => {
      const plateImage = plateImages[`${dk}|${name}`];
      if (!plateImage) return;
      const src = getSupabaseImageUrl("images_nobg", plateImage, { width: 340, format: "webp", quality: 75 });

      if (preloadedRef.current.has(src)) return;
      preloadedRef.current.add(src);
      const img = new window.Image();
      img.onload = () => markImageCached(src);
      img.src = src;
    });
  }, [plateImages]);

  // Trackpad horizontal swipe detection
  const lastWheelTimeRef = useRef(0);
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (Math.abs(e.deltaX) > 35 && Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.3) {
      const now = performance.now();
      if (now - lastWheelTimeRef.current < 350) return;
      lastWheelTimeRef.current = now;
      if (e.deltaX > 0 && selectedDay < 4) {
        handleDaySelect(selectedDay + 1);
      } else if (e.deltaX < 0 && selectedDay > 0) {
        handleDaySelect(selectedDay - 1);
      }
    }
  }, [selectedDay, handleDaySelect]);

  // High-performance touch swipe detection with velocity thresholding from mutu-web
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      touchStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        time: performance.now(),
      };
    }
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - touchStartRef.current.x;
    const deltaY = touch.clientY - touchStartRef.current.y;
    const dt = Math.max(1, performance.now() - touchStartRef.current.time);
    const vx = deltaX / dt;
    const width = typeof window !== "undefined" ? window.innerWidth : 360;
    touchStartRef.current = null;

    // Do not switch day if an overlay or modal is active
    if (infoOpen || actionSheet.isOpen || recipeModal.isOpen || weekOverviewOpen || leaderboardOpen || lightboxIndex >= 0) {
      return;
    }

    // Must be horizontally dominant to avoid triggering on vertical scroll
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 28) {
      if (shouldTurnPage({ mx: deltaX, vx, width, fraction: 0.08, velocity: 0.25 })) {
        if (deltaX < 0 && selectedDay < 4) {
          handleDaySelect(selectedDay + 1);
        } else if (deltaX > 0 && selectedDay > 0) {
          handleDaySelect(selectedDay - 1);
        }
      }
    }
  }, [selectedDay, handleDaySelect, infoOpen, actionSheet.isOpen, recipeModal.isOpen, weekOverviewOpen, leaderboardOpen, lightboxIndex]);

  const fullDayLabels = lang === "no" ? FULL_DAYS_NO : FULL_DAYS_EN;

  const maxVotes = useMemo(() => Math.max(0, ...sortedCanteens.map(([name]) => voting.votes[name] ?? 0)), [sortedCanteens, voting.votes]);

  // Shared with LoadingScreen so the shell shown while the menu loads and the
  // header that replaces it cannot print different dates for the same week.
  const { dateStr, dayLabelsData } = useMemo(() => ({
    dateStr: formatLongDate(displayMonday, selectedDay, lang),
    dayLabelsData: weekDayLabels(displayMonday),
  }), [selectedDay, lang, displayMonday]);

  const allDaysData = useMemo((): CanteenDayItem[][] => {
    return DAY_KEYS.map(dk => {
      return sortedCanteens.map(([canteenName, canteen]) => {
        const dayEntry = canteen.menu.find(d => d.day.toLowerCase() === dk);
        const noItems = dayEntry?.no?.items;
        const enItems = dayEntry?.en?.items;
        const rawItems = lang === "no"
          ? (noItems && noItems.length > 0 ? noItems : enItems)
          : (enItems && enItems.length > 0 ? enItems : noItems);
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
          ? getClosedPlateUrl(`${canteenName}-${dk}`, { width: 340, format: "webp", quality: 75 })
          : plateImage
            ? getSupabaseImageUrl("images_nobg", plateImage, { width: 340, format: "webp", quality: 75 })
            : "";
        const highResImagePath = isClosed
          ? getClosedPlateUrl(`${canteenName}-${dk}`)
          : plateImage
            ? getSupabaseImageUrl("images_nobg", plateImage)
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
          ? (typeof descEntry === "string" ? descEntry : descEntry[lang] || descEntry["en"] || null)
          : null;
        // Pull availability notes from the user's preferred language; fall back
        // to the other language if the canteen only published one side.
        const langNotes = dayEntry?.[lang]?.availabilityNotes;
        const otherNotes = dayEntry?.[lang === "no" ? "en" : "no"]?.availabilityNotes;
        const availabilityNotes = (langNotes?.length ? langNotes : otherNotes) || [];
        return {
          canteenName, canteen, dayEntry, items, mainDish, sideDishes,
          mainAllergens, imageSlug, imagePath, highResImagePath,
          isOutdated, isAhead, canteenWeekNum, origin, description,
          availabilityNotes,
        };
      });
    });
  }, [sortedCanteens, lang, dishOrigins, dishDescriptions, displayWeek, plateImages]);

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
              lang === "no"
                ? `🎲 YOLO valgte ${winnerName} for deg i dag!`
                : `🎲 YOLO chose ${winnerName} for you today!`,
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
  }, [yoloSpinning, allDaysData, lang]);

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
    voting.handleShareSlack(canteenDayData, lang);
  }, [voting, canteenDayData, lang]);

  // `mounted` used to gate this too, which cost a painted frame of skeleton on
  // every load for no benefit: it is a leftover from when this was a Next.js
  // server component and the first client render had to match the server's.
  // There is no SSR any more — `menuData` arrives from the route loader before
  // this component exists — so the only thing left to wait for is the effect
  // flush, and waiting for it just showed the placeholder one frame longer.
  if (!menuData) {
    return <LoadingScreen lang={lang} />;
  }

  const todayKey = getLocalDateKey();
  const alreadyShared = typeof window !== "undefined" && !!localStorage.getItem(`slack_shared_${todayKey}`);

  const ShareButton = ({ className }: { className?: string }) => (
    <button
      className={`share-btn${alreadyShared ? " disabled" : ""}${voting.shareState === "sent" ? " sent" : ""}${className ? ` ${className}` : ""}`}
      disabled={alreadyShared || voting.shareState === "loading"}
      onClick={handleShareSlackWrapped}
      title={alreadyShared ? (lang === "no" ? "Allerede delt i dag" : "Already shared today") : undefined}
    >
      {voting.shareState === "sent"
        ? (lang === "no" ? "Sendt! \u2713" : "Sent! \u2713")
        : voting.shareState === "loading"
        ? "..."
        : (
          <>
            <Share2 size={14} style={{ marginRight: 6 }} />
            {lang === "no" ? "Del resultater" : "Share results"}
          </>
        )
      }
    </button>
  );

  return (
    <div className="app-wrapper">
      <AppHeader
        mode={mode}
        lang={lang}
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
          <ClosedCanteensPill closedCanteens={closedCanteens} lang={lang} />
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
          <div className="cards-track">
            <AnimatePresence initial={false} custom={direction}>
              <motion.div
                key={selectedDay}
                custom={direction}
                variants={{
                  // A spring, not a fixed 180ms curve.
                  //
                  // A duration-based tween arrives at exactly the same moment
                  // however hard the day was flicked, which is what makes the
                  // day change read as stiff: the motion has no relationship
                  // to the gesture that caused it. A spring settles instead of
                  // stopping, so the cards arrive with a little weight behind
                  // them and the strip feels like it is being pushed rather
                  // than being redrawn.
                  //
                  // Exit stays a short tween. The outgoing day is already
                  // fading and nobody is watching it settle; springing it out
                  // only keeps a dead element on screen longer.
                  enter: (dir: number) => ({
                    x: dir > 0 ? 28 : dir < 0 ? -28 : 0,
                    opacity: 0,
                  }),
                  center: {
                    x: 0,
                    opacity: 1,
                    transition: {
                      x: { type: "spring", stiffness: 320, damping: 32, mass: 0.7 },
                      opacity: { duration: 0.16, ease: "linear" },
                    },
                  },
                  exit: (dir: number) => ({
                    x: dir > 0 ? -24 : dir < 0 ? 24 : 0,
                    opacity: 0,
                    transition: {
                      x: { duration: 0.16, ease: [0.4, 0, 1, 1] },
                      opacity: { duration: 0.12, ease: "linear" },
                    },
                  }),
                }}
                initial="enter"
                animate="center"
                exit="exit"
                className="cards-animated-wrapper"
              >
                {openCanteens.length === 0 ? (
                  <AllClosedCard closedCanteens={closedCanteens} lang={lang} />
                ) : (
                  <>
                    {closedCanteens.length > 0 && (
                      <div className="closed-pill-mobile">
                        <ClosedCanteensPill closedCanteens={closedCanteens} lang={lang} />
                      </div>
                    )}
                    {canteenDayData.map((data, cardIdx) => (
                      isCanteenClosed(data) ? (
                        <ClosedCard
                          key={data.canteenName}
                          data={data}
                          cardIdx={cardIdx}
                          lang={lang}
                        />
                      ) : (
                        <FoodCard
                          key={data.canteenName}
                          data={data}
                          cardIdx={cardIdx}
                          lang={lang}
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
        lang={lang}
        mode={mode}
        onDaySelect={handleDaySelect}
        onDayHover={preloadDay}
        onTodayPress={mode === "weekday-current" ? () => runYolo(todayIndex) : undefined}
        cardsRef={scrollRef}
        pendingCanteens={pendingCanteens}
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
                <h2 id="info-title-id" className="info-title">{lang === "no" ? "Dagens" : "Today's"} <span>{lang === "no" ? "Lunsj" : "Lunch"}</span></h2>
                <p className="info-tagline">{lang === "no" ? "Din daglige lunsjfølgesvenn på Fornebu" : "Your daily lunch companion at Fornebu"}</p>
              </div>
              <div className="info-body">
                <p className="info-intro">
                  {lang === "no"
                    ? "En alt-i-ett lunsjapp som henter ferske menyer fra kantinene på Telenor Fornebu hver uke. Se hva som serveres, stem på favorittlunsjen din, og oppdag nye oppskrifter — alt på ett sted."
                    : "An all-in-one lunch app that scrapes fresh menus from the Telenor Fornebu canteens every week. See what's being served, vote on your favorite lunch, and discover new recipes — all in one place."}
                </p>
                <div className="info-features">
                  <div className="info-feature">
                    <span className="info-feature-icon">&#x1F37D;&#xFE0F;</span>
                    <div>
                      <strong>{lang === "no" ? "Daglige menyer" : "Daily menus"}</strong>
                      <span>{lang === "no" ? "Tre kantiner, fem dager, komplett med allergener og bilder generert av AI." : "Three canteens, five days, complete with allergens and AI-generated food imagery."}</span>
                    </div>
                  </div>
                  <div className="info-feature">
                    <span className="info-feature-icon">&#x1F5F3;&#xFE0F;</span>
                    <div>
                      <strong>{lang === "no" ? "Stem i dag" : "Vote today"}</strong>
                      <span>{lang === "no" ? "Se hvilken kantine kollegene dine velger. Stemmetall oppdateres i sanntid." : "See which canteen your colleagues are choosing. Vote counts update in real-time."}</span>
                    </div>
                  </div>
                  <div className="info-feature">
                    <span className="info-feature-icon">&#x1F468;&#x200D;&#x1F373;</span>
                    <div>
                      <strong>{lang === "no" ? "AI-oppskrifter" : "AI recipes"}</strong>
                      <span>{lang === "no" ? "Liker du retten? Få en komplett oppskrift med ingredienser, steg og koketips, laget av AI." : "Love a dish? Get a complete recipe with ingredients, steps, and cooking tips, generated by AI."}</span>
                    </div>
                  </div>
                  <div className="info-feature">
                    <span className="info-feature-icon">&#x1F6D2;</span>
                    <div>
                      <strong>{lang === "no" ? "Handle smart" : "Shop smart"}</strong>
                      <span>{lang === "no" ? "Finn de billigste ingrediensene på tvers av norske dagligvarebutikker, eller bygg en handleliste på MENY." : "Find the cheapest ingredients across Norwegian grocery stores, or build a shopping list at MENY."}</span>
                    </div>
                  </div>
                  <div className="info-feature">
                    <span className="info-feature-icon">&#x1F310;</span>
                    <div>
                      <strong>{lang === "no" ? "Tospråklig" : "Bilingual"}</strong>
                      <span>{lang === "no" ? "Full norsk og engelsk støtte — bytt med en knapp." : "Full Norwegian and English support — switch with a tap."}</span>
                    </div>
                  </div>
                </div>
                <div className="info-tech">
                  <p className="info-tech-label">{lang === "no" ? "Bygget med" : "Built with"}</p>
                  <p className="info-tech-stack">Next.js &middot; React 19 &middot; Gemini AI &middot; Upstash Redis &middot; Vercel</p>
                </div>
              </div>
              <div className="info-footer">
                <span className="info-made-by">{lang === "no" ? "Laget av" : "Made by"} Tom Hoel</span>
                <div className="info-footer-links">
                  <a href="mailto:tom.chamkrai.hoel@telenor.no?subject=Feedback%20on%20Canteen%20App" className="info-footer-link">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                    {lang === "no" ? "Tilbakemelding" : "Feedback"}
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
              lang={lang}
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
              lang={lang}
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
            lang={lang}
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
                    <span className="recipe-loading-text">{lang === "no" ? "S\u00F8ker hos Meny..." : "Searching Meny..."}</span>
                  </div>
                )}

                {menyView.error && (
                  <div className="recipe-error">
                    <p>{menyView.error}</p>
                    <button className="recipe-retry-btn" onClick={() => recipeModal.recipe && handleMenyClick(recipeModal.dishName, recipeModal.recipe)}>
                      {lang === "no" ? "Pr\u00F8v igjen" : "Try again"}
                    </button>
                  </div>
                )}

                {menyView.data && (
                  <Suspense fallback={null}>
                    <MenyView
                      meny={menyView.data}
                      lang={lang}
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
                    <span className="recipe-loading-text">{lang === "no" ? "Sammenligner priser..." : "Comparing prices..."}</span>
                  </div>
                )}

                {dealsView.error && (
                  <div className="recipe-error">
                    <p>{dealsView.error}</p>
                    <button className="recipe-retry-btn" onClick={() => recipeModal.recipe && handleDealsClick(recipeModal.dishName, recipeModal.recipe)}>
                      {lang === "no" ? "Pr\u00F8v igjen" : "Try again"}
                    </button>
                  </div>
                )}

                {dealsView.deals && (
                  <Suspense fallback={null}>
                    <DealsView
                      deals={dealsView.deals}
                      lang={lang}
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
                    <span className="recipe-loading-text">{lang === "no" ? "Genererer oppskrift..." : "Generating recipe..."}</span>
                  </div>
                )}

                {recipeModal.error && (
                  <div className="recipe-error">
                    <p>{recipeModal.error}</p>
                    <button className="recipe-retry-btn" onClick={() => handleRecipeClick(recipeModal.dishName, recipeModal.canteenName)}>
                      {lang === "no" ? "Pr\u00F8v igjen" : "Try again"}
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
                        <span className="recipe-servings-label">{lang === "no" ? "pers." : "serv."}</span>
                      </span>
                      <span>{lang === "no" ? "Prep" : "Prep"}: {recipe.prepTime}</span>
                      <span>{lang === "no" ? "Tilbereding" : "Cook"}: {recipe.cookTime}</span>
                    </div>
                    <div className="recipe-content">
                      <div className="recipe-ingredients">
                        <h3 className="recipe-section-title">{lang === "no" ? "Ingredienser" : "Ingredients"}{scale !== 1 ? ` (${"\u00D7"}${scale % 1 === 0 ? scale : scale.toFixed(1)})` : ""}</h3>
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
                          <span className="shop-divider-label">{lang === "no" ? "Handle" : "Shop"}</span>
                        </div>
                        <div className="recipe-shop-row" style={{ animationDelay: `${recipe.ingredients.length * 50 + 50}ms` }}>
                          <button className="shop-card shop-card-meny" onClick={() => handleMenyClick(recipeModal.dishName, recipe)}>
                            <span className="shop-card-icon shop-icon-meny">
                              <span className="shop-icon-check" />
                            </span>
                            <span className="shop-card-text">
                              <span className="shop-card-label">{lang === "no" ? "Handleliste" : "Shopping list"}</span>
                              <span className="shop-card-sub">Meny</span>
                            </span>
                          </button>
                          <button className="shop-card shop-card-deals" onClick={() => handleDealsClick(recipeModal.dishName, recipe)}>
                            <span className="shop-card-icon shop-icon-deals">
                              <span className="shop-icon-tag" />
                            </span>
                            <span className="shop-card-text">
                              <span className="shop-card-label">{lang === "no" ? "Ukens tilbud" : "Weekly deals"}</span>
                              <span className="shop-card-sub">{lang === "no" ? "Alle butikker" : "All stores"}</span>
                            </span>
                          </button>
                        </div>
                      </div>
                      <div className="recipe-steps">
                        <h3 className="recipe-section-title">{lang === "no" ? "Fremgangsm\u00E5te" : "Instructions"}</h3>
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
