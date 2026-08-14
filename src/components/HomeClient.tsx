"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useSearch, useNavigate } from "@tanstack/react-router";
import { FULL_DAYS_NO, FULL_DAYS_EN, DAY_KEYS, CANTEEN_ORDER, CANTEEN_IMAGE_SLUGS, getSupabaseImageUrl, getClosedPlateUrl } from "@/lib/constants";
import type { MenuData, CanteenData, CanteenDayItem, DishOrigin, DishDescription } from "@/lib/types";
import { getMealDbUrl, getSpoonUrl, getLetterFallback } from "@/lib/ingredientImg";
import { getLocalDateKey, computeDisplayContext, compareWeeks } from "@/lib/dateUtils";
import { useVoting } from "@/lib/useVoting";
import { useRecipe } from "@/lib/useRecipe";
import { useDeals } from "@/lib/useDeals";
import { useMenySearch } from "@/lib/useMenySearch";
import ErrorBoundary from "@/components/ErrorBoundary";
import SkeletonCards from "@/components/SkeletonCard";
import DaySelector from "@/components/DaySelector";
import FoodCard from "@/components/FoodCard";
import VoteModal from "@/components/VoteModal";
import Lightbox from "@/components/Lightbox";
import DealsView from "@/components/DealsView";
import MenyView from "@/components/MenyView";
import LeaderboardModal from "@/components/LeaderboardModal";
import WeekOverview from "@/components/WeekOverview";
import ClosedCanteensPill from "@/components/ClosedCanteensPill";
import AllClosedCard from "@/components/AllClosedCard";
import ClosedCard from "@/components/ClosedCard";
import { isCanteenClosed, getRankedItems } from "@/lib/canteen-utils";
import { useAppStore, setFeedbackModalOpen } from "@/store/useAppStore";
import { CanteenFeedbackForm } from "@/components/CanteenFeedbackForm";

export interface HomeClientProps {
  initialMenu: MenuData | null;
  initialOrigins: Record<string, DishOrigin>;
  initialDescriptions: Record<string, DishDescription>;
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

export default function HomeClient({ initialMenu, initialOrigins, initialDescriptions }: HomeClientProps) {
  const navigate = useNavigate({ from: "/" });
  const searchParams = useSearch({ strict: false }) as { day?: string };

  const [selectedDay, setSelectedDay] = useState(() => {
    if (searchParams?.day) {
      const idx = DAY_KEYS.indexOf(searchParams.day.toLowerCase() as typeof DAY_KEYS[number]);
      if (idx >= 0) return idx;
    }
    return 0;
  });

  useEffect(() => {
    if (searchParams?.day) {
      const idx = DAY_KEYS.indexOf(searchParams.day.toLowerCase() as typeof DAY_KEYS[number]);
      if (idx >= 0 && idx !== selectedDay) {
        setSelectedDay(idx);
      }
    }
  }, [searchParams?.day]);

  const [menuData] = useState<MenuData | null>(initialMenu);
  const [lang, setLang] = useState<"no" | "en">("no");
  const [langAnim, setLangAnim] = useState("");
  const [lightboxIndex, setLightboxIndex] = useState(-1);
  const [mounted, setMounted] = useState(false);
  // Bumped on visibilitychange + every 5 min to refresh date logic without reload.
  const [dateTick, setDateTick] = useState(0);
  const [voteModal, setVoteModal] = useState<{ isOpen: boolean; canteenName: string }>({ isOpen: false, canteenName: "" });
  const [actionSheet, setActionSheet] = useState<{ isOpen: boolean; canteenName: string; dishName: string; imagePath: string; description: string | null }>({ isOpen: false, canteenName: "", dishName: "", imagePath: "", description: null });
  const [dishOrigins] = useState<Record<string, DishOrigin>>(initialOrigins);
  const [dishDescriptions] = useState<Record<string, DishDescription>>(initialDescriptions);
  const [swipeDirection, setSwipeDirection] = useState<"swipe-left" | "swipe-right" | "">("");
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [weekOverviewOpen, setWeekOverviewOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [showSwipeHint, setShowSwipeHint] = useState(false);
  const feedbackModalOpen = useAppStore((state) => state.feedbackModalOpen);

  // YOLO randomiser: cycles a glow through the open canteens for ~5s then
  // settles on one. yoloHighlight is the currently-lit card during the spin;
  // yoloWinner is the finalist after deceleration completes.
  const [yoloSpinning, setYoloSpinning] = useState(false);
  const [yoloHighlight, setYoloHighlight] = useState<number>(-1);
  const [yoloWinner, setYoloWinner] = useState<number>(-1);
  const yoloTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Custom hooks — extracted state management
  const voting = useVoting();
  const { votes, hasVoted, votedCanteen, isVoting, voteSuccess, shareState, handleVote, handleShareSlack, setVoteSuccess, setShareState } = voting;
  const { recipeModal, recipeServings, setRecipeServings, handleRecipeClick, closeRecipe } = useRecipe(lang);
  const { dealsView, handleDealsClick, closeDeals } = useDeals(lang);
  const { menyView, handleMenyClick, closeMeny } = useMenySearch(lang);

  const scrollRef = useRef<HTMLElement>(null);

  // Touch tracking via refs (no re-renders on every pixel)
  const touchStartRef = useRef<number | null>(null);
  const touchEndRef = useRef<number | null>(null);

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

  const minSwipeDistance = 50;

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchEndRef.current = null;
    touchStartRef.current = e.targetTouches[0].clientX;
    if (showSwipeHint) setShowSwipeHint(false);
  }, [showSwipeHint]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    touchEndRef.current = e.targetTouches[0].clientX;
  }, []);

  const onTouchEnd = useCallback(() => {
    const start = touchStartRef.current;
    const end = touchEndRef.current;
    if (start === null || end === null) return;
    const distance = start - end;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;

    if (isLeftSwipe) {
      setSelectedDay(prev => {
        if (prev < 4) {
          const nextDay = prev + 1;
          setSwipeDirection("swipe-left");
          navigate({ search: (p: Record<string, unknown>) => ({ ...p, day: DAY_KEYS[nextDay] }), replace: true });
          return nextDay;
        }
        return prev;
      });
    }
    if (isRightSwipe) {
      setSelectedDay(prev => {
        if (prev > 0) {
          const nextDay = prev - 1;
          setSwipeDirection("swipe-right");
          navigate({ search: (p: Record<string, unknown>) => ({ ...p, day: DAY_KEYS[nextDay] }), replace: true });
          return nextDay;
        }
        return prev;
      });
    }
  }, [navigate]);

  const handleDaySelect = useCallback((i: number) => {
    setSelectedDay(prev => {
      if (i > prev) setSwipeDirection("swipe-left");
      else if (i < prev) setSwipeDirection("swipe-right");
      else setSwipeDirection("");
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

  const langAnimBusy = useRef(false);
  const handleLangSwitch = useCallback((newLang: "no" | "en") => {
    if (newLang === lang || langAnimBusy.current) return;
    langAnimBusy.current = true;
    setLangAnim(`lang-cascade-${newLang}`);
    setTimeout(() => setLang(newLang), 350);
    setTimeout(() => { setLangAnim("lang-done"); langAnimBusy.current = false; }, 780);
  }, [lang]);

  // Initial data loading + localStorage cleanup
  useEffect(() => {
    cleanupLocalStorage();

    const swipeHintSeen = localStorage.getItem("swipe_hint_seen");
    let swipeHintTimer: ReturnType<typeof setTimeout> | null = null;
    if (!swipeHintSeen) {
      setShowSwipeHint(true);
      localStorage.setItem("swipe_hint_seen", "1");
      swipeHintTimer = setTimeout(() => setShowSwipeHint(false), 2500);
    }

    // Menu, origins, descriptions arrive as props from the server component
    // (loaded directly from Supabase). No fetch waterfall on initial paint.
    setMounted(true);

    return () => {
      if (swipeHintTimer) clearTimeout(swipeHintTimer);
    };
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
      .map(([, c]) => parseInt(c.week.match(/\d+/)?.[0] || "0", 10))
      .filter(n => n > 0),
    [sortedCanteens],
  );

  // dateTick forces a recompute on visibility/interval so Sun→Mon transitions cleanly.
  const displayContext = useMemo(
    () => computeDisplayContext(canteenWeekNumbers),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canteenWeekNumbers, dateTick],
  );

  const { mode, weekNumber: displayWeek, todayIndex, anchor: displayMonday } = displayContext;

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
      if (e.key === "Escape") {
        if (menyView.isOpen) {
          closeMeny();
        } else if (dealsView.isOpen) {
          closeDeals();
        } else if (weekOverviewOpen) {
          setWeekOverviewOpen(false);
        } else if (leaderboardOpen) {
          setLeaderboardOpen(false);
        } else {
          setLightboxIndex(-1);
          setVoteModal({ isOpen: false, canteenName: "" });
          setActionSheet({ isOpen: false, canteenName: "", dishName: "", imagePath: "", description: null });
          closeRecipe();
        }
      } else if (e.key === "ArrowLeft") {
        if (selectedDay > 0 && lightboxIndex < 0 && !voteModal.isOpen && !actionSheet.isOpen && !recipeModal.isOpen) {
          handleDaySelect(selectedDay - 1);
        }
      } else if (e.key === "ArrowRight") {
        if (selectedDay < 4 && lightboxIndex < 0 && !voteModal.isOpen && !actionSheet.isOpen && !recipeModal.isOpen) {
          handleDaySelect(selectedDay + 1);
        }
      } else if (e.key === " ") {
        if (lightboxIndex < 0 && !voteModal.isOpen && !actionSheet.isOpen && !recipeModal.isOpen && !menyView.isOpen && !dealsView.isOpen && !weekOverviewOpen && !leaderboardOpen) {
          e.preventDefault();
          handleDaySelect(todayIndex >= 0 ? todayIndex : 0);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedDay, todayIndex, lightboxIndex, voteModal.isOpen, actionSheet.isOpen, recipeModal.isOpen, dealsView.isOpen, menyView.isOpen, weekOverviewOpen, leaderboardOpen, handleDaySelect, closeDeals, closeMeny, closeRecipe]);

  // Image preloading — tracks loaded URLs to avoid duplicates (#5)
  useEffect(() => {
    if (!menuData) return;

    const daysToPreload = [selectedDay];
    if (selectedDay > 0) daysToPreload.push(selectedDay - 1);
    if (selectedDay < 4) daysToPreload.push(selectedDay + 1);

    const preloadDay = (dayIdx: number) => {
      const dk = DAY_KEYS[dayIdx];
      if (!dk) return;
      CANTEEN_ORDER.forEach(name => {
        const slug = CANTEEN_IMAGE_SLUGS[name] || name.toLowerCase().replace(/\s+/g, "_");
        const supabasePath = `${dk}/${slug}.png`;
        const sbLowRes = getSupabaseImageUrl("images_nobg", supabasePath, { width: 440, format: "webp" });
        const src = sbLowRes || `/images_nobg/${dk}/${slug}.png`;
        
        if (preloadedRef.current.has(src)) return;
        preloadedRef.current.add(src);
        const img = new window.Image();
        img.src = src;
      });
    };

    // Load selected day immediately
    preloadDay(selectedDay);

    // Defer adjacent days by 1.5s
    const adjacentDays = daysToPreload.slice(1);
    const timer = setTimeout(() => {
      adjacentDays.forEach(preloadDay);
    }, 1500);

    return () => clearTimeout(timer);
  }, [menuData, selectedDay]);

  // Disable vertical scrolling when content fits viewport
  useEffect(() => {
    const checkScroll = () => {
      if (scrollRef.current) {
        const { scrollHeight, clientHeight } = scrollRef.current;
        if (scrollHeight > clientHeight + 50) {
          scrollRef.current.style.overflowY = "auto";
          scrollRef.current.style.touchAction = "pan-x pan-y";
        } else {
          scrollRef.current.style.overflowY = "hidden";
          scrollRef.current.style.touchAction = "pan-x";
        }
      }
    };

    const timeoutId = setTimeout(checkScroll, 50);
    window.addEventListener("resize", checkScroll);
    const observer = new ResizeObserver(() => checkScroll());
    if (scrollRef.current) observer.observe(scrollRef.current);

    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener("resize", checkScroll);
      observer.disconnect();
    };
  }, [mounted, menuData, selectedDay]);

  const fullDayLabels = lang === "no" ? FULL_DAYS_NO : FULL_DAYS_EN;

  const maxVotes = useMemo(() => Math.max(0, ...sortedCanteens.map(([name]) => voting.votes[name] ?? 0)), [sortedCanteens, voting.votes]);

  const weekLabel = `${lang === "no" ? "Uke" : "Week"} ${displayWeek}`;

  const { dateStr, dayLabelsData } = useMemo(() => {
    const t = new Date(displayMonday);
    t.setDate(displayMonday.getDate() + selectedDay);
    const dStr = t.toLocaleDateString(lang === "no" ? "nb-NO" : "en-GB", { day: "numeric", month: "long" });

    const labels = fullDayLabels.map((_, i) => {
      const dayDate = new Date(displayMonday);
      dayDate.setDate(displayMonday.getDate() + i);
      return `${dayDate.getDate().toString().padStart(2, "0")}.${(dayDate.getMonth() + 1).toString().padStart(2, "0")}`;
    });

    return { dateStr: dStr, dayLabelsData: labels };
  }, [selectedDay, lang, fullDayLabels, displayMonday]);

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

        // Supabase Integration: Prefer remote images if available.
        // Lightbox uses the transparent PNG so the food sits on the warm gradient
        // backdrop instead of the studio dark-grey from the bg version.
        const supabasePath = `${dk}/${imageSlug}.png`;
        const sbLowRes = isClosed
          ? getClosedPlateUrl(`${canteenName}-${dk}`, { width: 440, format: "webp" })
          : getSupabaseImageUrl("images_nobg", supabasePath, { width: 440, format: "webp" });
        const sbHighRes = isClosed
          ? getClosedPlateUrl(`${canteenName}-${dk}`)
          : getSupabaseImageUrl("images_nobg", supabasePath);

        const imagePath = sbLowRes || `/images_nobg/${dk}/${imageSlug}.png`;
        const highResImagePath = sbHighRes || `/images_nobg/${dk}/${imageSlug}.png`;
        const canteenWeekNum = parseInt(canteen.week.match(/\d+/)?.[0] || "0", 10);
        const cmp = canteenWeekNum > 0 ? compareWeeks(canteenWeekNum, displayWeek) : 0;
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
  }, [sortedCanteens, lang, dishOrigins, dishDescriptions, displayWeek]);

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

  if (!menuData || !mounted) {
    return (
      <div className="app-wrapper">
        <SkeletonCards />
      </div>
    );
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
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
              <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg>
            {lang === "no" ? "Del resultater" : "Share results"}
          </>
        )
      }
    </button>
  );

  return (
    <div className="app-wrapper">
      {/* Header */}
      <header className="app-header">
        <div className="hero-inline">
          <h1 className="hero-title">
            {mode === "weekday-current"
              ? (lang === "no" ? "Dagens" : "Today's")
              : mode === "weekend-preview"
              ? (lang === "no" ? "Neste ukes" : "Next week's")
              : (lang === "no" ? "Denne ukens" : "This week's")}{" "}
            <span>{lang === "no" ? "Lunsj" : "Lunch"}</span>
          </h1>
          <p className="hero-subtitle">{weekLabel} &bull; {fullDayLabels[selectedDay]} {dateStr}</p>
        </div>
        <div className="header-actions">
          <button className="info-btn" onClick={() => setInfoOpen(true)} title={lang === "no" ? "Om appen" : "About"}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.2"/><path d="M8 7v4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><circle cx="8" cy="4.75" r="0.65" fill="currentColor"/></svg>
          </button>
          <button
            className="info-btn"
            onClick={() => setLeaderboardOpen(true)}
            title={lang === "no" ? "Kantineseiere" : "Canteen wins"}
            aria-label={lang === "no" ? "Kantineseiere" : "Canteen wins"}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>
              <path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/>
              <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/>
              <path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/>
            </svg>
          </button>
          <button
            className="info-btn"
            onClick={() => setWeekOverviewOpen(true)}
            aria-label={lang === "no" ? "Ukeoversikt" : "Week overview"}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </button>
          <button
            className="info-btn"
            onClick={() => setFeedbackModalOpen(true)}
            title="Ønsk en rett"
            aria-label="Ønsk en rett"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </button>
        </div>
        {/* Closed canteens pill — inside header row on desktop, fixed banner on mobile */}
        {closedCanteens.length > 0 && openCanteens.length > 0 && (
          <ClosedCanteensPill closedCanteens={closedCanteens} lang={lang} />
        )}
      </header>

      {/* Cards */}
      <main className={`cards-container${langAnim ? ` ${langAnim}` : ""}`} ref={scrollRef} onScroll={handleScroll} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
        {showSwipeHint && (
          <>
            <span className="swipe-hint-left" aria-hidden="true">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </span>
            <span className="swipe-hint-right" aria-hidden="true">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </span>
          </>
        )}
        <ErrorBoundary>
          <div key={selectedDay} className={`cards-animated-wrapper ${swipeDirection}`}>
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
        onTodayPress={mode === "weekday-current" ? () => runYolo(todayIndex) : undefined}
        cardsRef={scrollRef}
      />

      {/* Info Modal */}
      {infoOpen && (
        <div className="info-overlay" onClick={() => setInfoOpen(false)}>
          <div className="info-modal" onClick={e => e.stopPropagation()}>
            <button className="info-close" onClick={() => setInfoOpen(false)}>&times;</button>
            <div className="info-header">
              <h2 className="info-title">{lang === "no" ? "Dagens" : "Today's"} <span>{lang === "no" ? "Lunsj" : "Lunch"}</span></h2>
              <p className="info-tagline">{lang === "no" ? "Din daglige lunsjf\u00F8lgesvenn p\u00E5 Fornebu" : "Your daily lunch companion at Fornebu"}</p>
            </div>
            <div className="info-body">
              <p className="info-intro">
                {lang === "no"
                  ? "En alt-i-ett lunsjapp som henter ferske menyer fra kantinene p\u00E5 Telenor Fornebu hver uke. Se hva som serveres, stem p\u00E5 favorittlunsjen din, og oppdag nye oppskrifter \u2014 alt p\u00E5 ett sted."
                  : "An all-in-one lunch app that scrapes fresh menus from the Telenor Fornebu canteens every week. See what's being served, vote on your favorite lunch, and discover new recipes \u2014 all in one place."}
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
                    <span>{lang === "no" ? "Liker du retten? F\u00E5 en komplett oppskrift med ingredienser, steg og koketips, laget av AI." : "Love a dish? Get a complete recipe with ingredients, steps, and cooking tips, generated by AI."}</span>
                  </div>
                </div>
                <div className="info-feature">
                  <span className="info-feature-icon">&#x1F6D2;</span>
                  <div>
                    <strong>{lang === "no" ? "Handle smart" : "Shop smart"}</strong>
                    <span>{lang === "no" ? "Finn de billigste ingrediensene p\u00E5 tvers av norske dagligvarebutikker, eller bygg en handleliste p\u00E5 MENY." : "Find the cheapest ingredients across Norwegian grocery stores, or build a shopping list at MENY."}</span>
                  </div>
                </div>
                <div className="info-feature">
                  <span className="info-feature-icon">&#x1F310;</span>
                  <div>
                    <strong>{lang === "no" ? "Tospr\u00E5klig" : "Bilingual"}</strong>
                    <span>{lang === "no" ? "Full norsk og engelsk st\u00F8tte \u2014 bytt med en knapp." : "Full Norwegian and English support \u2014 switch with a tap."}</span>
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
          </div>
        </div>
      )}

      <LeaderboardModal
        isOpen={leaderboardOpen}
        lang={lang}
        onClose={() => setLeaderboardOpen(false)}
      />

      {weekOverviewOpen && (
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
      )}

      {/* Vote Modal */}
      <VoteModal
        isOpen={voteModal.isOpen}
        canteenName={voteModal.canteenName}
        hasVoted={voting.hasVoted}
        votedCanteen={voting.votedCanteen}
        canteenNames={openCanteens.filter(c => !c.isOutdated && !c.isAhead).map(c => c.canteenName)}
        votes={voting.votes}
        maxVotes={maxVotes}
        lang={lang}
        isVoting={voting.isVoting}
        onVote={voting.handleVote}
        onClose={() => setVoteModal({ isOpen: false, canteenName: "" })}
      />

      {/* Action Sheet */}
      {actionSheet.isOpen && (() => {
        const closeSheet = () => { setActionSheet({ isOpen: false, canteenName: "", dishName: "", imagePath: "", description: null }); voting.setVoteSuccess(false); voting.setShareState("idle"); };
        const sheetCanteen = canteenDayData.find(c => c.canteenName === actionSheet.canteenName);
        const canVote = mode === "weekday-current" && selectedDay === todayIndex && sheetCanteen && !sheetCanteen.isOutdated && !sheetCanteen.isAhead;
        return (
        <div className="action-sheet-overlay" onClick={closeSheet}>
          <div className="action-sheet" onClick={e => e.stopPropagation()}>
            <div className="action-sheet-handle" />
            <button className="action-sheet-close" onClick={closeSheet} aria-label="Close">&#xD7;</button>

            {/* Hero image */}
            <div className="action-sheet-hero">
              <img src={actionSheet.imagePath} alt={actionSheet.dishName} className="action-sheet-img" />
              <div className="action-sheet-hero-fade" />
            </div>

            {/* Header */}
            <div className="action-sheet-header">
              <span className="action-sheet-canteen">{actionSheet.canteenName}</span>
              <h3 className="action-sheet-dish">{actionSheet.dishName}</h3>
              {actionSheet.description && (
                <p className="action-sheet-desc">{actionSheet.description}</p>
              )}
            </div>

            {/* Actions */}
            {voting.voteSuccess ? (
              <div className="action-sheet-success">
                <div className="vote-celebration">
                  <span className="celebration-emoji celebration-1">&#x1F389;</span>
                  <span className="celebration-emoji celebration-2">&#x2B50;</span>
                  <span className="celebration-emoji celebration-3">&#x1F38A;</span>
                  <span className="celebration-emoji celebration-4">&#x2728;</span>
                  <span className="celebration-emoji celebration-5">&#x1F973;</span>
                </div>
                <div className="vote-success-check">&#x2714;</div>
                <span className="vote-success-text">{lang === "no" ? "Takk for stemmen!" : "Thanks for voting!"}</span>
                <span className="vote-success-sub">{actionSheet.canteenName}</span>
                <ShareButton />
              </div>
            ) : (
            <div className="action-sheet-actions">
              {canVote && (
              <button
                className={`action-sheet-btn action-sheet-vote${voting.hasVoted ? " voted" : ""}${voting.isVoting ? " voting" : ""}`}
                disabled={voting.hasVoted || voting.isVoting}
                onClick={async () => {
                  await voting.handleVote(actionSheet.canteenName);
                }}
              >
                <div className="action-sheet-btn-icon-wrap action-sheet-icon-vote">
                  {voting.isVoting ? "\u23F3" : voting.hasVoted ? "\u2714" : "\uD83D\uDDF3\uFE0F"}
                </div>
                <div className="action-sheet-btn-text">
                  <span className="action-sheet-btn-label">
                    {voting.isVoting
                      ? (lang === "no" ? "Stemmer..." : "Voting...")
                      : voting.hasVoted
                      ? (lang === "no" ? "Allerede stemt" : "Already voted")
                      : (lang === "no" ? "Stem p\u00E5 denne" : "Vote for this")}
                  </span>
                  <span className="action-sheet-btn-sub">
                    {voting.hasVoted
                      ? (lang === "no" ? `Du stemte p\u00E5 ${voting.votedCanteen}` : `You voted for ${voting.votedCanteen}`)
                      : (lang === "no" ? "Vis at du spiser her i dag" : "Show you\u2019re eating here today")}
                  </span>
                </div>
                {!voting.hasVoted && !voting.isVoting && <span className="action-sheet-btn-arrow">&#x203A;</span>}
              </button>
              )}
              <button
                className="action-sheet-btn action-sheet-recipe"
                onClick={() => { closeSheet(); handleRecipeClick(actionSheet.dishName, actionSheet.canteenName); }}
              >
                <div className="action-sheet-btn-icon-wrap action-sheet-icon-recipe">&#x1F468;&#x200D;&#x1F373;</div>
                <div className="action-sheet-btn-text">
                  <span className="action-sheet-btn-label">{lang === "no" ? "Lag hjemme" : "Make at home"}</span>
                  <span className="action-sheet-btn-sub">{lang === "no" ? "F\u00E5 AI-generert oppskrift" : "Get AI-generated recipe"}</span>
                </div>
                <span className="action-sheet-btn-arrow">&#x203A;</span>
              </button>
              {canVote && <ShareButton />}
            </div>
            )}
          </div>
        </div>
        );
      })()}

      {/* Lightbox with canteen swipe */}
      <Lightbox
        isOpen={lightboxIndex >= 0}
        currentIndex={lightboxIndex}
        canteenDayData={openCanteens}
        onClose={() => setLightboxIndex(-1)}
        onNavigate={setLightboxIndex}
      />

      {/* Recipe Modal */}
      {recipeModal.isOpen && (
        <div className="recipe-overlay" onClick={() => { closeRecipe(); closeDeals(); closeMeny(); }}>
          <div className="recipe-modal" onClick={e => e.stopPropagation()}>
            <button className="recipe-close" onClick={() => { closeRecipe(); closeDeals(); closeMeny(); }}>&#xD7;</button>

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
                  <MenyView
                    meny={menyView.data}
                    lang={lang}
                    onBack={closeMeny}
                  />
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
                  <DealsView
                    deals={dealsView.deals}
                    lang={lang}
                    isStreaming={dealsView.isStreaming}
                    onBack={closeDeals}
                  />
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
          </div>
        </div>
      )}
      {feedbackModalOpen && <CanteenFeedbackForm onClose={() => setFeedbackModalOpen(false)} />}
    </div>
  );
}
