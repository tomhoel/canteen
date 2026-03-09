"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { FULL_DAYS_NO, FULL_DAYS_EN, DAY_KEYS, CANTEEN_ORDER, CANTEEN_IMAGE_SLUGS } from "@/lib/constants";
import type { MenuData, CanteenData, Recipe, DealsResponse } from "@/lib/types";
import { getMealDbUrl, getSpoonUrl, getLetterFallback } from "@/lib/ingredientImg";
import DaySelector from "@/components/DaySelector";
import FoodCard from "@/components/FoodCard";
import VoteModal from "@/components/VoteModal";
import Lightbox from "@/components/Lightbox";
import DealsView from "@/components/DealsView";

export default function Home() {
  const [menuData, setMenuData] = useState<MenuData | null>(null);
  const [lang, setLang] = useState<"no" | "en">("no");
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
  const [dealsView, setDealsView] = useState<{ isOpen: boolean; deals: DealsResponse | null; isLoading: boolean; error: string | null }>({ isOpen: false, deals: null, isLoading: false, error: null });

  const scrollRef = useRef<HTMLElement>(null);
  const votesLoadedRef = useRef(false);

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
    touchEndRef.current = null;
    touchStartRef.current = e.targetTouches[0].clientX;
  }, []);

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

  const handleRecipeClick = useCallback(async (dishName: string, canteenName: string, forceRefresh = false) => {
    const cacheKey = `recipe_v2_${dishName}`;
    if (!forceRefresh) {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        try {
          const recipe = JSON.parse(cached) as Recipe;
          setRecipeServings(recipe.servings);
          setRecipeModal({ isOpen: true, dishName, canteenName, recipe, isLoading: false, error: null });
          return;
        } catch { /* cache corrupted, refetch */ }
      }
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
    const cacheKey = `deals_${dishName}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as DealsResponse;
        const age = Date.now() - new Date(parsed.generatedAt).getTime();
        if (age < 24 * 60 * 60 * 1000) {
          setDealsView({ isOpen: true, deals: parsed, isLoading: false, error: null });
          return;
        }
      } catch { /* stale/corrupt cache */ }
    }

    setDealsView({ isOpen: true, deals: null, isLoading: true, error: null });
    try {
      const res = await fetch('/api/deals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredients: recipe.ingredients, dishName, lang }),
      });
      if (!res.ok) throw new Error('Failed');
      const deals = await res.json() as DealsResponse;
      localStorage.setItem(cacheKey, JSON.stringify(deals));
      setDealsView(prev => ({ ...prev, deals, isLoading: false }));
    } catch {
      setDealsView(prev => ({ ...prev, isLoading: false, error: lang === 'no' ? 'Kunne ikke finne tilbud' : 'Could not find deals' }));
    }
  }, [lang]);

  useEffect(() => {
    const jsDay = new Date().getDay();
    const isWeekday = jsDay >= 1 && jsDay <= 5;
    const idx = isWeekday ? jsDay - 1 : -1;
    setTodayIndex(idx);
    setSelectedDay(isWeekday ? jsDay - 1 : 4);

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
      stopPolling();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (dealsView.isOpen) {
          setDealsView({ isOpen: false, deals: null, isLoading: false, error: null });
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
  }, [selectedDay, lightboxIndex, voteModal.isOpen, actionSheet.isOpen, recipeModal.isOpen, dealsView.isOpen, handleDaySelect]);

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
  const dayKey = DAY_KEYS[selectedDay];
  const activeDayIndex = todayIndex >= 0 ? todayIndex : 4;

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

  const canteenDayData = useMemo(() => {
    return sortedCanteens.map(([canteenName, canteen]) => {
      const dayEntry = canteen.menu.find(d => d.day.toLowerCase() === dayKey);
      const noItems = dayEntry?.no?.items;
      const enItems = dayEntry?.en?.items;
      const items = lang === "no"
        ? (noItems && noItems.length > 0 ? noItems : enItems)
        : (enItems && enItems.length > 0 ? enItems : noItems);
      const mainDish = items?.find(i => i.isMain);
      const sideDishes = items?.filter(i => !i.isMain).slice(0, 2) || [];
      const mainAllergens = mainDish?.allergens || [];
      const imageSlug = CANTEEN_IMAGE_SLUGS[canteenName] || canteenName.toLowerCase().replace(/\s+/g, "_");
      const imagePath = `/images_nobg/${dayKey}/${imageSlug}.png`;
      const highResImagePath = `/images/${dayKey}/${imageSlug}.png`;
      const canteenWeekNum = parseInt(canteen.week.match(/\d+/)?.[0] || "0", 10);
      const isOutdated = canteenWeekNum < currentWeek;
      const isAhead = canteenWeekNum > currentWeek;

      const enMainDish = (dayEntry?.en?.items || []).find(i => i.isMain);
      const origin = dishOrigins[enMainDish?.dish || ""] ?? null;
      const descEntry = dishDescriptions[enMainDish?.dish || ""];
      const description = descEntry
        ? (typeof descEntry === "string" ? descEntry : descEntry[lang] || descEntry["en"] || null)
        : null;

      return {
        canteenName, canteen, dayEntry, items, mainDish, sideDishes,
        mainAllergens, imageSlug, imagePath, highResImagePath,
        isOutdated, isAhead, canteenWeekNum, origin, description,
      };
    });
  }, [sortedCanteens, dayKey, lang, dishOrigins, dishDescriptions, currentWeek]);

  // #6 — Lightbox image click handler using canteen index
  const handleImageClick = useCallback((data: { canteenName: string }) => {
    const idx = canteenDayData.findIndex(c => c.canteenName === data.canteenName);
    setLightboxIndex(idx >= 0 ? idx : 0);
  }, [canteenDayData]);

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

  if (!menuData || !mounted) {
    return (
      <div className="app-wrapper" style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
        <span style={{ color: "#999" }}>Loading...</span>
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
        <div className="lang-switcher">
          <button className={lang === "no" ? "lang-btn active" : "lang-btn"} onClick={() => setLang("no")}>NO</button>
          <button className={lang === "en" ? "lang-btn active" : "lang-btn"} onClick={() => setLang("en")}>EN</button>
        </div>
      </header>

      {/* Cards */}
      <main className="cards-container" ref={scrollRef} onScroll={handleScroll} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
        <div key={selectedDay} className={`cards-animated-wrapper ${swipeDirection}`}>
          {canteenDayData.map((data, cardIdx) => (
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
          ))}
        </div>
      </main>

      {/* #4 — Day Selector with ahead-canteen awareness */}
      <DaySelector
        fullDayLabels={fullDayLabels}
        dayLabelsData={dayLabelsData}
        selectedDay={selectedDay}
        todayIndex={todayIndex}
        lang={lang}
        hasAheadCanteens={hasAheadCanteens}
        onDaySelect={handleDaySelect}
      />

      {/* Credit */}
      <div className="credit-badge">Made by Tom Hoel @ Telenor Finance</div>

      {/* Feedback */}
      <a href="mailto:tom.chamkrai.hoel@telenor.no?subject=Feedback%20on%20Canteen%20App" className="feedback-btn" title={lang === "no" ? "Send tilbakemelding" : "Send feedback"}>
        <span className="feedback-icon">&#x2709;&#xFE0F;</span>
        <span className="feedback-text">{lang === "no" ? "Tilbakemelding" : "Feedback"}</span>
      </a>

      {/* Vote Modal */}
      <VoteModal
        isOpen={voteModal.isOpen}
        canteenName={voteModal.canteenName}
        hasVoted={hasVoted}
        votedCanteen={votedCanteen}
        canteenNames={canteenDayData.filter(c => !c.isOutdated && !c.isAhead).map(c => c.canteenName)}
        votes={votes}
        maxVotes={maxVotes}
        lang={lang}
        isVoting={isVoting}
        onVote={handleVote}
        onClose={() => setVoteModal({ isOpen: false, canteenName: "" })}
      />

      {/* Action Sheet */}
      {actionSheet.isOpen && (() => {
        const closeSheet = () => { setActionSheet({ isOpen: false, canteenName: "", dishName: "", imagePath: "", description: null }); setVoteSuccess(false); };
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
              </div>
            ) : (
            <div className="action-sheet-actions">
              {canVote && (
              <button
                className={`action-sheet-btn action-sheet-vote${hasVoted ? " voted" : ""}${isVoting ? " voting" : ""}`}
                disabled={hasVoted || isVoting}
                onClick={async () => {
                  await handleVote(actionSheet.canteenName);
                  setTimeout(closeSheet, 1500);
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
        canteenDayData={canteenDayData}
        onClose={() => setLightboxIndex(-1)}
        onNavigate={setLightboxIndex}
      />

      {/* Recipe Modal */}
      {recipeModal.isOpen && (
        <div className="recipe-overlay" onClick={() => { setRecipeModal(prev => ({ ...prev, isOpen: false })); setDealsView({ isOpen: false, deals: null, isLoading: false, error: null }); }}>
          <div className="recipe-modal" onClick={e => e.stopPropagation()}>
            <button className="recipe-close" onClick={() => { setRecipeModal(prev => ({ ...prev, isOpen: false })); setDealsView({ isOpen: false, deals: null, isLoading: false, error: null }); }}>&#xD7;</button>

            {recipeModal.recipe && !recipeModal.isLoading && !dealsView.isOpen && (
              <button
                className="recipe-regenerate-btn"
                onClick={() => handleRecipeClick(recipeModal.dishName, recipeModal.canteenName, true)}
                title={lang === "no" ? "Generer ny oppskrift" : "Regenerate recipe"}
              >
                &#x1F504;
              </button>
            )}

            {dealsView.isOpen ? (
              <>
                <div className="recipe-header">
                  <span className="recipe-canteen">{recipeModal.canteenName}</span>
                  <h2 className="recipe-dish-name">{recipeModal.dishName}</h2>
                </div>

                {dealsView.isLoading && (
                  <div className="recipe-loading">
                    <span className="recipe-loading-emoji deals-loading-cart">{"\uD83D\uDED2"}</span>
                    <span className="recipe-loading-text">{lang === "no" ? "S\u00F8ker etter tilbud..." : "Searching for deals..."}</span>
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
                    onBack={() => setDealsView({ isOpen: false, deals: null, isLoading: false, error: null })}
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
                                <span className="recipe-ingredient-name">{ing.item}</span>
                                <span className="recipe-ingredient-amount">{scaleAmount(ing.amount)} {ing.unit}</span>
                              </div>
                            </li>
                            );
                          })}
                        </ul>
                        {/* Find Deals Button */}
                        <button
                          className="deals-find-btn"
                          style={{ animationDelay: `${recipe.ingredients.length * 50 + 50}ms` }}
                          onClick={() => handleDealsClick(recipeModal.dishName, recipe)}
                        >
                          <span className="deals-find-icon">{"\uD83D\uDED2"}</span>
                          <span className="deals-find-text">
                            <span className="deals-find-label">{lang === "no" ? "Finn tilbud" : "Find deals"}</span>
                            <span className="deals-find-sub">{lang === "no" ? "Se beste priser p\u00E5 ingrediensene" : "See best prices on ingredients"}</span>
                          </span>
                          <span className="deals-find-arrow">{"\u203A"}</span>
                        </button>
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
