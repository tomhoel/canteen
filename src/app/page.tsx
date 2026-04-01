"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { DAYS_NO, DAYS_EN, FULL_DAYS_NO, FULL_DAYS_EN, DAY_KEYS, CANTEEN_ORDER, CANTEEN_IMAGE_SLUGS } from "@/lib/constants";
import type { MenuData, CanteenData, CanteenDayItem, Recipe, DealsResponse, MenyResponse, ProductOffer } from "@/lib/types";
import { getMealDbUrl, getSpoonUrl, getLetterFallback } from "@/lib/ingredientImg";
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
import { isCanteenClosed } from "@/lib/canteen-utils";

export default function Home() {
  const [menuData, setMenuData] = useState<MenuData | null>(null);
  const [lang, setLang] = useState<"no" | "en">("no");
  const [langAnim, setLangAnim] = useState("");
  const [selectedDay, setSelectedDay] = useState(0);
  const [todayIndex, setTodayIndex] = useState(-1);
  const [lightboxIndex, setLightboxIndex] = useState(-1);
  const [mounted, setMounted] = useState(false);
  const [votes, setVotes] = useState<Record<string, number>>({});
  const [voteModal, setVoteModal] = useState<{ isOpen: boolean; canteenName: string }>({ isOpen: false, canteenName: "" });
  const [actionSheet, setActionSheet] = useState<{ isOpen: boolean; canteenName: string; dishName: string; imagePath: string; description: string | null }>({ isOpen: false, canteenName: "", dishName: "", imagePath: "", description: null });
  const [hasVoted, setHasVoted] = useState(false);
  const [votedCanteen, setVotedCanteen] = useState("");
  const [isVoting, setIsVoting] = useState(false);
  const [voteSuccess, setVoteSuccess] = useState(false);
  const [dishOrigins, setDishOrigins] = useState<Record<string, { country: string; code: string }>>({});
  const [dishDescriptions, setDishDescriptions] = useState<Record<string, string | { en: string; no: string }>>({});
  const [recipeModal, setRecipeModal] = useState<{ isOpen: boolean; dishName: string; canteenName: string; recipe: Recipe | null; isLoading: boolean; error: string | null }>({ isOpen: false, dishName: "", canteenName: "", recipe: null, isLoading: false, error: null });
  const [recipeServings, setRecipeServings] = useState(4);
  const [swipeDirection, setSwipeDirection] = useState<"swipe-left" | "swipe-right" | "">("");
  const [dealsView, setDealsView] = useState<{ isOpen: boolean; deals: DealsResponse | null; isLoading: boolean; isStreaming: boolean; error: string | null }>({ isOpen: false, deals: null, isLoading: false, isStreaming: false, error: null });
  const [menyView, setMenyView] = useState<{ isOpen: boolean; data: MenyResponse | null; isLoading: boolean; error: string | null }>({ isOpen: false, data: null, isLoading: false, error: null });
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [weekOverviewOpen, setWeekOverviewOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [showSwipeHint, setShowSwipeHint] = useState(false);
  const [shareState, setShareState] = useState<"idle" | "loading" | "sent">("idle");

  const scrollRef = useRef<HTMLElement>(null);
  const votesLoadedRef = useRef(false);
  const shareInFlightRef = useRef(false);

  // #9 — Touch tracking via refs instead of state (no re-renders on every pixel)
  const touchStartRef = useRef<number | null>(null);
  const touchEndRef = useRef<number | null>(null);

  // #14 — Debounced scroll position save
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // #14 — Debounced scroll handler (200ms)
  const handleScroll = useCallback((e: React.UIEvent<HTMLElement>) => {
    const top = e.currentTarget.scrollTop;
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    scrollTimerRef.current = setTimeout(() => {
      localStorage.setItem("canteenScrollPos", top.toString());
    }, 200);
  }, []);

  const minSwipeDistance = 50;

  // #9 — Touch handlers use refs
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (showSwipeHint) setShowSwipeHint(false);
    touchEndRef.current = null;
    touchStartRef.current = e.targetTouches[0].clientX;
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
      setSelectedDay(prev => { if (prev < 4) { setSwipeDirection("swipe-left"); return prev + 1; } return prev; });
    }
    if (isRightSwipe) {
      setSelectedDay(prev => { if (prev > 0) { setSwipeDirection("swipe-right"); return prev - 1; } return prev; });
    }
  }, []);

  const handleDaySelect = useCallback((i: number) => {
    setSelectedDay(prev => {
      if (i > prev) setSwipeDirection("swipe-left");
      else if (i < prev) setSwipeDirection("swipe-right");
      else setSwipeDirection("");
      return i;
    });
  }, []);

  const langAnimBusy = useRef(false);
  const handleLangSwitch = useCallback((newLang: "no" | "en") => {
    if (newLang === lang || langAnimBusy.current) return;
    langAnimBusy.current = true;
    // Single continuous animation — swap content mid-animation when all cards are in the
    // invisible zone (22%–65% of keyframes).  350ms guarantees card 3 (100ms delay) has
    // reached opacity 0 before React re-renders with new language content.
    setLangAnim(`lang-cascade-${newLang}`);
    setTimeout(() => setLang(newLang), 350);
    // Swap to lang-done (suppresses cardReveal replay) instead of clearing
    setTimeout(() => { setLangAnim("lang-done"); langAnimBusy.current = false; }, 780);
  }, [lang]);

  const handleRecipeClick = useCallback(async (dishName: string, canteenName: string) => {
    const cacheKey = `recipe_v4_${lang}_${dishName}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        const recipe = JSON.parse(cached) as Recipe;
        setRecipeServings(recipe.servings);
        setRecipeModal({ isOpen: true, dishName, canteenName, recipe, isLoading: false, error: null });
        return;
      } catch { /* cache corrupted, refetch */ }
    }
    setRecipeModal({ isOpen: true, dishName, canteenName, recipe: null, isLoading: true, error: null });
    try {
      const res = await fetch('/api/recipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dishName, lang }),
      });
      if (!res.ok) throw new Error('Failed');
      const recipe = await res.json() as Recipe;
      localStorage.setItem(cacheKey, JSON.stringify(recipe));
      setRecipeServings(recipe.servings);
      setRecipeModal(prev => ({ ...prev, recipe, isLoading: false }));
    } catch {
      setRecipeModal(prev => ({ ...prev, isLoading: false, error: lang === 'no' ? 'Kunne ikke generere oppskrift' : 'Could not generate recipe' }));
    }
  }, [lang]);

  const handleDealsClick = useCallback(async (dishName: string, recipe: Recipe) => {
    // Check localStorage cache
    const cacheKey = `deals_v4_${dishName}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as DealsResponse;
        const age = Date.now() - new Date(parsed.generatedAt).getTime();
        if (age < 24 * 60 * 60 * 1000) {
          setDealsView({ isOpen: true, deals: parsed, isLoading: false, isStreaming: false, error: null });
          return;
        }
      } catch { /* stale/corrupt cache */ }
    }

    setDealsView({ isOpen: true, deals: null, isLoading: true, isStreaming: true, error: null });
    try {
      const res = await fetch('/api/deals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredients: recipe.ingredients, dishName, lang }),
      });
      if (!res.ok) throw new Error('Failed');

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        // Cached response from Redis — not streaming
        const deals = await res.json() as DealsResponse;
        localStorage.setItem(cacheKey, JSON.stringify(deals));
        setDealsView(prev => ({ ...prev, deals, isLoading: false, isStreaming: false }));
      } else {
        // Streaming SSE response
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const accumulated: ProductOffer[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';

          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith('data: ')) continue;
            const data = JSON.parse(line.slice(6));

            if (data.type === 'ingredient') {
              accumulated.push(...(data.deals as ProductOffer[]));
              // Build partial DealsResponse for immediate display
              const partial: DealsResponse = {
                recommendation: { store: '', storeColor: '', storeLogo: '', totalPrice: 0, dealCount: 0, keyIngredientsCovered: 0, deals: [] },
                allStores: [{ store: '_stream', storeColor: '', storeLogo: '', totalPrice: 0, dealCount: accumulated.length, keyIngredientsCovered: 0, deals: [...accumulated] }],
                searchedIngredients: [data.name],
                generatedAt: '',
              };
              setDealsView(prev => {
                // Merge searchedIngredients from previous partial
                const prevSearched = prev.deals?.searchedIngredients || [];
                partial.searchedIngredients = [...prevSearched, data.name];
                return { ...prev, deals: partial };
              });
            } else if (data.type === 'done') {
              const { type: _, ...response } = data;
              const deals = response as DealsResponse;
              localStorage.setItem(cacheKey, JSON.stringify(deals));
              setDealsView(prev => ({ ...prev, deals, isLoading: false, isStreaming: false }));
            } else if (data.type === 'error') {
              setDealsView(prev => ({ ...prev, isLoading: false, isStreaming: false, error: lang === 'no' ? 'Kunne ikke finne priser' : 'Could not find prices' }));
            }
          }
        }
      }
    } catch {
      setDealsView(prev => ({ ...prev, isLoading: false, isStreaming: false, error: lang === 'no' ? 'Kunne ikke finne priser' : 'Could not find prices' }));
    }
  }, [lang]);

  const handleMenyClick = useCallback(async (dishName: string, recipe: Recipe) => {
    const cacheKey = `meny_v4_${dishName}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as MenyResponse;
        const age = Date.now() - new Date(parsed.generatedAt).getTime();
        if (age < 24 * 60 * 60 * 1000) {
          setMenyView({ isOpen: true, data: parsed, isLoading: false, error: null });
          return;
        }
      } catch { /* stale/corrupt cache */ }
    }

    setMenyView({ isOpen: true, data: null, isLoading: true, error: null });
    try {
      const res = await fetch('/api/meny/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredients: recipe.ingredients, dishName, lang }),
      });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json() as MenyResponse;
      localStorage.setItem(cacheKey, JSON.stringify(data));
      setMenyView(prev => ({ ...prev, data, isLoading: false }));
    } catch {
      setMenyView(prev => ({ ...prev, isLoading: false, error: lang === 'no' ? 'Kunne ikke søke hos Meny' : 'Could not search Meny' }));
    }
  }, [lang]);

  useEffect(() => {
    const swipeHintSeen = localStorage.getItem("swipe_hint_seen");
    let swipeHintTimer: ReturnType<typeof setTimeout> | null = null;
    if (!swipeHintSeen) {
      setShowSwipeHint(true);
      localStorage.setItem("swipe_hint_seen", "1");
      swipeHintTimer = setTimeout(() => setShowSwipeHint(false), 2500);
    }

    const jsDay = new Date().getDay();
    const isWeekday = jsDay >= 1 && jsDay <= 5;
    const idx = isWeekday ? jsDay - 1 : -1;
    setTodayIndex(idx);
    setSelectedDay(isWeekday ? jsDay - 1 : 0);

    fetch("/menu.json")
      .then(r => r.json())
      .then(menu => setMenuData(menu));

    fetch("/dish-origins.json")
      .then(r => r.ok ? r.json() : {})
      .then(data => setDishOrigins(data || {}))
      .catch(() => {});

    fetch("/dish-descriptions.json")
      .then(r => r.ok ? r.json() : {})
      .then(data => setDishDescriptions(data || {}))
      .catch(() => {});

    fetch("/api/attendance")
      .then(r => r.json())
      .then(data => {
        setVotes(data.canteens || {});
        votesLoadedRef.current = true;
      });

    setMounted(true);
    const todayKey = new Date().toISOString().split("T")[0];
    const voted = localStorage.getItem(`voted_${todayKey}`);
    if (voted) { setHasVoted(true); setVotedCanteen(voted); }

    // #10 — Pause polling when tab is hidden
    let interval: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      if (interval) clearInterval(interval);
      interval = setInterval(() => {
        fetch("/api/attendance").then(r => r.json()).then(data => setVotes(data.canteens || {}));
      }, 60000);
    };

    const stopPolling = () => {
      if (interval) { clearInterval(interval); interval = null; }
    };

    const handleVisibility = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        // Fetch immediately on return, then resume polling
        fetch("/api/attendance").then(r => r.json()).then(data => setVotes(data.canteens || {}));
        startPolling();
      }
    };

    startPolling();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      if (swipeHintTimer) clearTimeout(swipeHintTimer);
      stopPolling();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (menyView.isOpen) {
          setMenyView({ isOpen: false, data: null, isLoading: false, error: null });
        } else if (dealsView.isOpen) {
          setDealsView({ isOpen: false, deals: null, isLoading: false, isStreaming: false, error: null });
        } else if (weekOverviewOpen) {
          setWeekOverviewOpen(false);
        } else if (leaderboardOpen) {
          setLeaderboardOpen(false);
        } else {
          setLightboxIndex(-1);
          setVoteModal({ isOpen: false, canteenName: "" });
          setActionSheet({ isOpen: false, canteenName: "", dishName: "", imagePath: "", description: null });
          setRecipeModal(prev => ({ ...prev, isOpen: false }));
        }
      } else if (e.key === "ArrowLeft") {
        if (selectedDay > 0 && lightboxIndex < 0 && !voteModal.isOpen && !actionSheet.isOpen && !recipeModal.isOpen) {
          handleDaySelect(selectedDay - 1);
        }
      } else if (e.key === "ArrowRight") {
        if (selectedDay < 4 && lightboxIndex < 0 && !voteModal.isOpen && !actionSheet.isOpen && !recipeModal.isOpen) {
          handleDaySelect(selectedDay + 1);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedDay, lightboxIndex, voteModal.isOpen, actionSheet.isOpen, recipeModal.isOpen, dealsView.isOpen, menyView.isOpen, weekOverviewOpen, leaderboardOpen, handleDaySelect]);

  // #11 — Only preload current day + adjacent days (not all 5)
  useEffect(() => {
    if (!menuData) return;

    const daysToPreload = [selectedDay];
    if (selectedDay > 0) daysToPreload.push(selectedDay - 1);
    if (selectedDay < 4) daysToPreload.push(selectedDay + 1);

    // Load selected day immediately
    const currentDayKey = DAY_KEYS[selectedDay];
    if (currentDayKey) {
      CANTEEN_ORDER.forEach(name => {
        const slug = CANTEEN_IMAGE_SLUGS[name] || name.toLowerCase().replace(/\s+/g, "_");
        const img = new window.Image();
        img.src = `/images_nobg/${currentDayKey}/${slug}.png`;
      });
    }

    // Defer adjacent days by 1.5s
    const adjacentDays = daysToPreload.slice(1);
    const timer = setTimeout(() => {
      adjacentDays.forEach(dayIdx => {
        const dk = DAY_KEYS[dayIdx];
        if (dk) {
          CANTEEN_ORDER.forEach(name => {
            const slug = CANTEEN_IMAGE_SLUGS[name] || name.toLowerCase().replace(/\s+/g, "_");
            const img = new window.Image();
            img.src = `/images_nobg/${dk}/${slug}.png`;
          });
        }
      });
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
  const activeDayIndex = todayIndex >= 0 ? todayIndex : 0;

  const sortedCanteens = useMemo(() => {
    if (!menuData) return [];
    return CANTEEN_ORDER
      .filter(name => menuData.canteens[name])
      .map(name => [name, menuData.canteens[name]] as [string, CanteenData]);
  }, [menuData]);

  const maxVotes = useMemo(() => Math.max(0, ...sortedCanteens.map(([name]) => votes[name] ?? 0)), [sortedCanteens, votes]);

  const currentWeek = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  }, []);

  const weekLabel = `${lang === "no" ? "Uke" : "Week"} ${currentWeek}`;

  // #4 — Detect ahead canteens and calculate appropriate dates
  const hasAheadCanteens = useMemo(() => {
    return sortedCanteens.some(([, canteen]) => {
      const canteenWeekNum = parseInt(canteen.week.match(/\d+/)?.[0] || "0", 10);
      return canteenWeekNum > currentWeek;
    });
  }, [sortedCanteens, currentWeek]);

  const { dateStr, dayLabelsData } = useMemo(() => {
    const selectedDate = new Date();
    const currentDayOfWeek = selectedDate.getDay();
    const mondayOffset = currentDayOfWeek === 0 ? -6 : 1 - currentDayOfWeek;
    const m = new Date(selectedDate);
    m.setDate(selectedDate.getDate() + mondayOffset);

    // #4 — If canteens are ahead, shift dates forward by 7 days
    const displayMonday = new Date(m);
    if (hasAheadCanteens) {
      displayMonday.setDate(displayMonday.getDate() + 7);
    }

    const t = new Date(displayMonday);
    t.setDate(displayMonday.getDate() + selectedDay);
    const dStr = t.toLocaleDateString(lang === "no" ? "nb-NO" : "en-GB", { day: "numeric", month: "long" });

    const labels = fullDayLabels.map((_, i) => {
      const dayDate = new Date(displayMonday);
      dayDate.setDate(displayMonday.getDate() + i);
      return `${dayDate.getDate().toString().padStart(2, "0")}.${(dayDate.getMonth() + 1).toString().padStart(2, "0")}`;
    });

    return { dateStr: dStr, dayLabelsData: labels };
  }, [selectedDay, lang, fullDayLabels, hasAheadCanteens]);

  const allDaysData = useMemo((): CanteenDayItem[][] => {
    return DAY_KEYS.map(dk => {
      return sortedCanteens.map(([canteenName, canteen]) => {
        const dayEntry = canteen.menu.find(d => d.day.toLowerCase() === dk);
        const noItems = dayEntry?.no?.items;
        const enItems = dayEntry?.en?.items;
        const items = lang === "no"
          ? (noItems && noItems.length > 0 ? noItems : enItems)
          : (enItems && enItems.length > 0 ? enItems : noItems);
        const mainDish = items?.find(i => i.isMain);
        const displaySideDishes = items?.filter(i => !i.isMain).slice(0, 3) || [];
        const noMainDish = noItems?.find(i => i.isMain);
        const noSideDishes = noItems?.filter(i => !i.isMain) || [];
        const mainAllergens = noMainDish?.allergens || mainDish?.allergens || [];
        const sideDishes = displaySideDishes.map((item, idx) => ({
          ...item,
          allergens: noSideDishes[idx]?.allergens || item.allergens,
        }));
        const imageSlug = CANTEEN_IMAGE_SLUGS[canteenName] || canteenName.toLowerCase().replace(/\s+/g, "_");
        const imagePath = `/images_nobg/${dk}/${imageSlug}.png`;
        const highResImagePath = `/images/${dk}/${imageSlug}.png`;
        const canteenWeekNum = parseInt(canteen.week.match(/\d+/)?.[0] || "0", 10);
        const isOutdated = canteenWeekNum < currentWeek;
        const isAhead = canteenWeekNum > currentWeek;
        const enLookup = dayEntry?.en?.items || [];
        const noLookup = dayEntry?.no?.items || [];
        const lookupMainDish = (enLookup.length > 0 ? enLookup : noLookup).find(i => i.isMain);
        const origin = dishOrigins[lookupMainDish?.dish || ""] ?? null;
        const descEntry = dishDescriptions[lookupMainDish?.dish || ""];
        const description = descEntry
          ? (typeof descEntry === "string" ? descEntry : descEntry[lang] || descEntry["en"] || null)
          : null;
        return {
          canteenName, canteen, dayEntry, items, mainDish, sideDishes,
          mainAllergens, imageSlug, imagePath, highResImagePath,
          isOutdated, isAhead, canteenWeekNum, origin, description,
        };
      });
    });
  }, [sortedCanteens, lang, dishOrigins, dishDescriptions, currentWeek]);

  const canteenDayData = useMemo(() => allDaysData[selectedDay] ?? [], [allDaysData, selectedDay]);
  const openCanteens = useMemo(() => canteenDayData.filter(c => !isCanteenClosed(c)), [canteenDayData]);
  const closedCanteens = useMemo(() => canteenDayData.filter(c => isCanteenClosed(c)), [canteenDayData]);

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

  const handleVote = useCallback(async (canteenName: string) => {
    setIsVoting(true);
    const res = await fetch("/api/attendance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ canteenName, action: "add" }),
    });
    const data = await res.json();
    setVotes(data.canteens || {});
    const todayKey = new Date().toISOString().split("T")[0];
    localStorage.setItem(`voted_${todayKey}`, canteenName);
    setVotedCanteen(canteenName);
    setHasVoted(true);
    setIsVoting(false);
    setVoteSuccess(true);
  }, []);

  const handleShareSlack = useCallback(async () => {
    if (shareInFlightRef.current) return;
    const todayKey = new Date().toISOString().split("T")[0];
    const alreadyShared = !!localStorage.getItem(`slack_shared_${todayKey}`);
    if (alreadyShared) return;

    shareInFlightRef.current = true;
    setShareState("loading");
    const dishes = Object.fromEntries(
      canteenDayData.map(c => [c.canteenName, c.mainDish?.dish ?? ""])
    );

    try {
      const res = await fetch("/api/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canteens: votes, dishes, date: todayKey, lang }),
      });
      if (!res.ok) throw new Error(`notify failed: ${res.status}`);
      localStorage.setItem(`slack_shared_${todayKey}`, "1");
      setShareState("sent");
      setTimeout(() => setShareState("idle"), 2000);
    } catch {
      setShareState("idle");
    } finally {
      shareInFlightRef.current = false;
    }
  }, [canteenDayData, votes, lang]);

  if (!menuData || !mounted) {
    return (
      <div className="app-wrapper">
        <SkeletonCards />
      </div>
    );
  }

  return (
    <div className="app-wrapper">
      {/* Header */}
      <header className="app-header">
        <div className="hero-inline">
          <h1 className="hero-title">{lang === "no" ? "Dagens" : "Today's"} <span>{lang === "no" ? "Lunsj" : "Lunch"}</span></h1>
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
          <div className="lang-switcher">
            <button className={lang === "no" ? "lang-btn active" : "lang-btn"} onClick={() => handleLangSwitch("no")}>NO</button>
            <button className={lang === "en" ? "lang-btn active" : "lang-btn"} onClick={() => handleLangSwitch("en")}>EN</button>
          </div>
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
        <div key={selectedDay} className={`cards-animated-wrapper ${swipeDirection}${openCanteens.length > 0 && openCanteens.length < 3 ? " few-cards" : ""}`}>
          {openCanteens.length === 0 ? (
            <AllClosedCard closedCanteens={closedCanteens} lang={lang} />
          ) : (
            openCanteens.map((data, cardIdx) => (
              <FoodCard
                key={data.canteenName}
                data={data}
                cardIdx={cardIdx}
                lang={lang}
                selectedDay={selectedDay}
                activeDayIndex={activeDayIndex}
                voteCount={votes[data.canteenName] ?? 0}
                maxVotes={maxVotes}
                onImageClick={handleImageClick}
                onCardClick={handleCardClick}
              />
            ))
          )}
        </div>
      </main>

      {/* #4 — Day Selector + closed canteens text below */}
      <DaySelector
        fullDayLabels={fullDayLabels}
        dayLabelsData={dayLabelsData}
        selectedDay={selectedDay}
        todayIndex={todayIndex}
        lang={lang}
        hasAheadCanteens={hasAheadCanteens}
        onDaySelect={handleDaySelect}
        cardsRef={scrollRef}
      />

      {/* Info Modal */}
      {infoOpen && (
        <div className="info-overlay" onClick={() => setInfoOpen(false)}>
          <div className="info-modal" onClick={e => e.stopPropagation()}>
            <button className="info-close" onClick={() => setInfoOpen(false)}>&times;</button>
            <div className="info-header">
              <h2 className="info-title">{lang === "no" ? "Dagens" : "Today's"} <span>{lang === "no" ? "Lunsj" : "Lunch"}</span></h2>
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
          todayIndex={activeDayIndex}
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
        hasVoted={hasVoted}
        votedCanteen={votedCanteen}
        canteenNames={openCanteens.filter(c => !c.isOutdated).map(c => c.canteenName)}
        votes={votes}
        maxVotes={maxVotes}
        lang={lang}
        isVoting={isVoting}
        onVote={handleVote}
        onClose={() => setVoteModal({ isOpen: false, canteenName: "" })}
      />

      {/* Action Sheet */}
      {actionSheet.isOpen && (() => {
        const closeSheet = () => { setActionSheet({ isOpen: false, canteenName: "", dishName: "", imagePath: "", description: null }); setVoteSuccess(false); setShareState("idle"); };
        const sheetCanteen = canteenDayData.find(c => c.canteenName === actionSheet.canteenName);
        const canVote = selectedDay === activeDayIndex && sheetCanteen && !sheetCanteen.isOutdated && !sheetCanteen.isAhead;
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
            {voteSuccess ? (
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
                {(() => {
                  const todayKey = new Date().toISOString().split("T")[0];
                  const alreadyShared = !!localStorage.getItem(`slack_shared_${todayKey}`);
                  return (
                    <button
                      className={`share-btn${alreadyShared ? " disabled" : ""}${shareState === "sent" ? " sent" : ""}`}
                      disabled={alreadyShared || shareState === "loading"}
                      onClick={handleShareSlack}
                      title={alreadyShared ? (lang === "no" ? "Allerede delt i dag" : "Already shared today") : undefined}
                    >
                      {shareState === "sent"
                        ? (lang === "no" ? "Sendt! ✓" : "Sent! ✓")
                        : shareState === "loading"
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
                })()}
              </div>
            ) : (
            <div className="action-sheet-actions">
              {canVote && (
              <button
                className={`action-sheet-btn action-sheet-vote${hasVoted ? " voted" : ""}${isVoting ? " voting" : ""}`}
                disabled={hasVoted || isVoting}
                onClick={async () => {
                  await handleVote(actionSheet.canteenName);
                  if (!canVote) {
                    setTimeout(closeSheet, 1500);
                  }
                  // When canVote is true, keep sheet open so user can share results
                }}
              >
                <div className="action-sheet-btn-icon-wrap action-sheet-icon-vote">
                  {isVoting ? "\u23F3" : hasVoted ? "\u2714" : "\uD83D\uDDF3\uFE0F"}
                </div>
                <div className="action-sheet-btn-text">
                  <span className="action-sheet-btn-label">
                    {isVoting
                      ? (lang === "no" ? "Stemmer..." : "Voting...")
                      : hasVoted
                      ? (lang === "no" ? "Allerede stemt" : "Already voted")
                      : (lang === "no" ? "Stem p\u00E5 denne" : "Vote for this")}
                  </span>
                  <span className="action-sheet-btn-sub">
                    {hasVoted
                      ? (lang === "no" ? `Du stemte p\u00E5 ${votedCanteen}` : `You voted for ${votedCanteen}`)
                      : (lang === "no" ? "Vis at du spiser her i dag" : "Show you\u2019re eating here today")}
                  </span>
                </div>
                {!hasVoted && !isVoting && <span className="action-sheet-btn-arrow">&#x203A;</span>}
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
              {canVote && (() => {
                const todayKey = new Date().toISOString().split("T")[0];
                const alreadyShared = !!localStorage.getItem(`slack_shared_${todayKey}`);
                return (
                  <button
                    className={`share-btn${alreadyShared ? " disabled" : ""}${shareState === "sent" ? " sent" : ""}`}
                    disabled={alreadyShared || shareState === "loading"}
                    onClick={handleShareSlack}
                    title={alreadyShared ? (lang === "no" ? "Allerede delt i dag" : "Already shared today") : undefined}
                  >
                    {shareState === "sent"
                      ? (lang === "no" ? "Sendt! ✓" : "Sent! ✓")
                      : shareState === "loading"
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
              })()}
            </div>
            )}
          </div>
        </div>
        );
      })()}

      {/* #6 — Lightbox with canteen swipe */}
      <Lightbox
        isOpen={lightboxIndex >= 0}
        currentIndex={lightboxIndex}
        canteenDayData={openCanteens}
        onClose={() => setLightboxIndex(-1)}
        onNavigate={setLightboxIndex}
      />

      {/* Recipe Modal */}
      {recipeModal.isOpen && (
        <div className="recipe-overlay" onClick={() => { setRecipeModal(prev => ({ ...prev, isOpen: false })); setDealsView({ isOpen: false, deals: null, isLoading: false, isStreaming: false, error: null }); setMenyView({ isOpen: false, data: null, isLoading: false, error: null }); }}>
          <div className="recipe-modal" onClick={e => e.stopPropagation()}>
            <button className="recipe-close" onClick={() => { setRecipeModal(prev => ({ ...prev, isOpen: false })); setDealsView({ isOpen: false, deals: null, isLoading: false, isStreaming: false, error: null }); setMenyView({ isOpen: false, data: null, isLoading: false, error: null }); }}>&#xD7;</button>

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
                    onBack={() => setMenyView({ isOpen: false, data: null, isLoading: false, error: null })}
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
                    onBack={() => setDealsView({ isOpen: false, deals: null, isLoading: false, isStreaming: false, error: null })}
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
    </div>
  );
}
