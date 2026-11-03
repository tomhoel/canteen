"use client";

import { useState, useEffect, useMemo, useRef, useCallback, lazy, Suspense } from "react";
import { useSearch, setSearchParam } from "@/lib/useSearch";
import { useCloseRequest, CLOSE_REQUESTS_HANDLED_BY_PLATFORM } from "@/lib/useCloseRequest";
import { markImageCached } from "@/lib/imageCache";
import { FULL_DAYS_NO, DAY_KEYS, CANTEEN_ORDER, getImageUrl, getClosedPlateUrl, PLATE_CARD_WIDTH } from "@/lib/constants";
import type { MenuData, CanteenData, CanteenDayItem, DishOrigin, DishDescription } from "@/lib/types";
import {
  computeDisplayContext,
  compareWeeks,
  parseCanteenWeekNumber,
  weekDayLabels,
  formatLongDate,
} from "@/lib/dateUtils";
import { useVoting } from "@/lib/useVoting";
import ErrorBoundary from "@/components/ErrorBoundary";
import LoadingScreen from "@/components/LoadingScreen";
import { useIsDesktop } from "@/lib/useIsDesktop";
import AppHeader from "@/components/AppHeader";
import DaySelector from "@/components/DaySelector";
import ClosedCanteensPill from "@/components/ClosedCanteensPill";
import DayPanel from "@/components/DayPanel";
import { isCanteenClosed, getRankedItems } from "@/lib/canteen-utils";
import { useShellInert } from "@/lib/useShellInert";
import { useDayScroller } from "@/lib/useDayScroller";
import { cleanupLocalStorage } from "@/lib/cleanupLocalStorage";

// These only render once the user opens an overlay: the action sheet, the
// plate lightbox and the info panel. Importing them eagerly put every one
// of them (and their own dependencies, e.g. Lightbox's copy of `motion`) in
// the same chunk the very first paint has to wait on. Splitting them out, and
// only mounting each one once its own "open" condition is true (see the call
// sites below), means a visitor who never opens any of these never pays for
// their JS at all.
const Lightbox = lazy(() => import("@/components/Lightbox"));
// The action sheet belongs in that list too, and was the one overlay left out
// of it. It is only reachable by tapping a card, but importing it eagerly put
// `ui/sheet.tsx` and with it the whole of `@use-gesture/react` — the
// drag-to-dismiss gesture, needed by nothing else in the app — into the chunk
// the first paint waits on.
const ActionSheet = lazy(() => import("@/components/ActionSheet"));
const InfoModal = lazy(() => import("@/components/InfoModal"));

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
   * Only the server knows, via dish_cache, which dish each stored plate depicts.
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
  /** The open lightbox's animated close, so Escape and Android back fly the plate home too. */
  const lightboxCloseRef = useRef<(() => void) | null>(null);
  const [mounted, setMounted] = useState(false);
  // Bumped on visibilitychange + every 5 min to refresh date logic without reload.
  const [dateTick, setDateTick] = useState(0);
  const [actionSheet, setActionSheet] = useState<{ isOpen: boolean; canteenName: string; dishName: string; imagePath: string }>({ isOpen: false, canteenName: "", dishName: "", imagePath: "" });
  const [dishOrigins, setDishOrigins] = useState<Record<string, DishOrigin>>(initialOrigins);
  const [dishDescriptions, setDishDescriptions] = useState<Record<string, DishDescription>>(initialDescriptions);
  const [dishShortNames, setDishShortNames] = useState<Record<string, string>>(initialShortNames);

  useEffect(() => {
    setMenuData(initialMenu);
    setDishOrigins(initialOrigins);
    setDishDescriptions(initialDescriptions);
    setDishShortNames(initialShortNames);
  }, [initialMenu, initialOrigins, initialDescriptions, initialShortNames]);
  /** False until the first day change, so only the first day on screen plays the opening entrance. */
  const [navigated, setNavigated] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);


  // Custom hooks — extracted state management. Everything below reaches voting
  // state through `voting.x`; the destructure that used to sit here bound ten
  // names nothing referenced.
  const voting = useVoting();

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
  const anyOverlayOpen = infoOpen || actionSheet.isOpen || lightboxIndex >= 0;

  // The overlays that render inline in this file rather than claiming the
  // shell themselves (ActionSheet claims via ui/sheet; the refcount makes an
  // overlap harmless).
  useShellInert(infoOpen || lightboxIndex >= 0);

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

  /** The dock shows the day a glide is heading to before it is committed. */
  const [previewDay, setPreviewDay] = useState<number | null>(null);

  /** Commits a day change. useDayScroller calls it once the board comes to rest. */
  const commitDay = useCallback((i: number) => {
    setNavigated(true);
    setSelectedDay(prev => (i === prev ? prev : i));
    // replaceState, as before: tapping through the weekdays must not stack
    // history entries, or Back walks Friday -> Thursday instead of leaving the
    // app. setSearchParam rewrites this one key and leaves the rest of the
    // query string alone.
    setSearchParam("day", DAY_KEYS[i]);
  }, []);

  // Finger, trackpad, dock and keys -> one native scroll of the board. See useDayScroller.
  const { scrollerRef: trackRef, goToDay: handleDaySelect } = useDayScroller({
    selectedDay,
    onSelectDay: commitDay,
    onPreviewDay: setPreviewDay,
    ready: menuData !== null,
  });

  // Initial data loading + localStorage cleanup
  useEffect(() => {
    cleanupLocalStorage();
    // Menu, origins, descriptions arrive as props from the server component
    // (loaded directly from storage). No fetch waterfall on initial paint.
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

  /**
   * Close the innermost open overlay.
   *
   * The order here is a real decision, not an accident of listing: Escape inside
   * the Meny sub-view returns to the recipe rather than closing everything. That
   * is why this walks a chain instead of using the derived `anyOverlayOpen`
   * above.
   *
   * Both the Escape key and the platform close request (the Android back
   * gesture) run it, so the two cannot drift apart.
   */
  const closeTopmostOverlay = useCallback(() => {
    if (infoOpen) {
      setInfoOpen(false);
    } else if (lightboxCloseRef.current) {
      lightboxCloseRef.current();
    } else {
      setLightboxIndex(-1);
      setActionSheet((sheet) => ({ ...sheet, isOpen: false }));
    }
  }, [infoOpen]);

  /**
   * The Android back gesture closes the topmost overlay instead of the app.
   *
   * The depth counts the layers that are actually open, so the watcher re-arms
   * as each one closes and back walks the stack a press at a time. At zero, no
   * watcher exists and back leaves the app, which is what it should do from the
   * menu itself. See `useCloseRequest` for why this is not `history.pushState`.
   */
  useCloseRequest(
    (infoOpen ? 1 : 0) + (lightboxIndex >= 0 ? 1 : 0) + (actionSheet.isOpen ? 1 : 0),
    closeTopmostOverlay
  );

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      const isInput = tag === "input" || tag === "textarea" || tag === "select";

      if (e.key === "Escape") {
        // Where CloseWatcher exists it already delivers Escape, and running the
        // chain here as well would walk it twice. Let the watcher own it.
        if (!CLOSE_REQUESTS_HANDLED_BY_PLATFORM) closeTopmostOverlay();
      } else if (e.key === "ArrowLeft" && !isInput) {
        if (selectedDay > 0 && !anyOverlayOpen) {
          // Ours, not the scroller's own 40px nudge if it happens to have focus.
          e.preventDefault();
          handleDaySelect(selectedDay - 1);
        }
      } else if (e.key === "ArrowRight" && !isInput) {
        if (selectedDay < 4 && !anyOverlayOpen) {
          e.preventDefault();
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
    // `closeTopmostOverlay` now carries every overlay state this effect used to
    // list for Escape's sake, and it is memoised on exactly those, so the ones
    // left here are the ones the arrow and space branches actually read.
  }, [selectedDay, todayIndex, anyOverlayOpen, handleDaySelect, closeTopmostOverlay]);

  // On-demand image preloader for other days — warms a day when hovered or touched
  const preloadDay = useCallback((dayIdx: number) => {
    const dk = DAY_KEYS[dayIdx];
    if (!dk) return;
    CANTEEN_ORDER.forEach(name => {
      const plateImage = plateImages[`${dk}|${name}`];
      if (!plateImage) return;
      const src = getImageUrl("images_nobg", plateImage, { width: plateWidth });

      if (preloadedRef.current.has(src)) return;
      preloadedRef.current.add(src);
      const img = new window.Image();
      img.onload = () => markImageCached(src);
      img.src = src;
    });
  }, [plateImages, plateWidth]);

  // The days either side are what a swipe reveals, so their plates are fetched
  // as soon as the browser is idle after each day lands. Without this the
  // neighbour slid in as empty circles that filled in mid-glide.
  useEffect(() => {
    if (!menuData) return;
    const run = () => {
      preloadDay(selectedDay - 1);
      preloadDay(selectedDay + 1);
    };
    if (window.requestIdleCallback) {
      const id = window.requestIdleCallback(run, { timeout: 1200 });
      return () => window.cancelIdleCallback?.(id);
    }
    const t = setTimeout(run, 300);
    return () => clearTimeout(t);
  }, [menuData, selectedDay, preloadDay]);

  const fullDayLabels = FULL_DAYS_NO;
  // The header names the day the board is heading to as soon as it sets off.
  const shownDay = previewDay ?? selectedDay;

  const maxVotes = useMemo(() => Math.max(0, ...sortedCanteens.map(([name]) => voting.votes[name] ?? 0)), [sortedCanteens, voting.votes]);

  // Shared with LoadingScreen so the shell shown while the menu loads and the
  // header that replaces it cannot print different dates for the same week.
  const { dateStr, dayLabelsData } = useMemo(() => ({
    dateStr: formatLongDate(displayMonday, shownDay),
    dayLabelsData: weekDayLabels(displayMonday),
  }), [shownDay, displayMonday]);

  const allDaysData = useMemo((): CanteenDayItem[][] => {
    return DAY_KEYS.map(dk => {
      return sortedCanteens.map(([canteenName, canteen]) => {
        const dayEntry = canteen.menu.find(d => d.day.toLowerCase() === dk);
        // The ranking was decided once by the updater and stored (see
        // dish-ranking.ts); getRankedItems returns it as stored.
        const items = getRankedItems(dayEntry?.no?.items, canteenName);
        const mainDish = items.find(i => i.isMain && i.dish.trim());
        // Items with an empty `dish` are dropped: older stored weeks have them
        // from a scraper bug fixed long ago.
        const sideDishes = items.filter(i => !i.isMain && i.dish.trim()).slice(0, 3);
        const mainAllergens = mainDish?.allergens || [];
        // Closed canteens point at one of 3 static cutlery-and-napkin plates
        // hosted in storage. We don't generate dish images for closed days.
        const isClosed = !mainDish || ["stengt", "closed", "lukket"].some(kw => mainDish.dish.toLowerCase().includes(kw));

        // The server resolves which stored plate belongs to this card; an absent
        // entry means no picture exists for this dish yet, and the card's
        // onError placeholder is the honest answer. Lightbox uses the
        // untransformed transparent PNG so the food sits on the warm gradient
        // backdrop instead of the studio dark-grey from the bg version.
        const plateImage = plateImages[`${dk}|${canteenName}`];
        const imagePath = isClosed
          ? getClosedPlateUrl(`${canteenName}-${dk}`, { width: plateWidth })
          : plateImage
            ? getImageUrl("images_nobg", plateImage, { width: plateWidth })
            : "";
        // The lightbox asks for 1080, which is past the thumb cut-off, so it gets
        // the full 1024px plate: WebP with alpha, so the cut-out still sits on
        // the gradient backdrop. Card widths get the 512px thumb instead.
        const highResImagePath = isClosed
          ? getClosedPlateUrl(`${canteenName}-${dk}`, { width: 1080 })
          : plateImage
            ? getImageUrl("images_nobg", plateImage, { width: 1080 })
            : "";
        // CanteenDayItem models "no usable week label" as undefined, not null.
        const canteenWeekNum = parseCanteenWeekNumber(canteen.week) ?? undefined;
        const cmp = canteenWeekNum !== undefined ? compareWeeks(canteenWeekNum, displayWeek) : 0;
        const isOutdated = cmp === -1;
        const isAhead = cmp === 1;
        const origin = dishOrigins[mainDish?.dish || ""] ?? null;
        const descEntry = dishDescriptions[mainDish?.dish || ""];
        const description = descEntry
          ? (typeof descEntry === "string" ? descEntry : descEntry["no"] || null)
          : null;
        const availabilityNotes = dayEntry?.no?.availabilityNotes || [];
        // The headline the card prints: the short title when the updater made one.
        const displayDishName =
          dishShortNames[mainDish?.dish || ""] || mainDish?.dish || null;
        return {
          canteenName, canteen, dayEntry, items, mainDish, sideDishes,
          mainAllergens, imagePath, highResImagePath,
          isOutdated, isAhead, canteenWeekNum, origin, description,
          displayDishName, availabilityNotes,
        };
      });
    });
  }, [sortedCanteens, dishOrigins, dishDescriptions, dishShortNames, displayWeek, plateImages, plateWidth]);

  const canteenDayData = useMemo(() => allDaysData[selectedDay] ?? [], [allDaysData, selectedDay]);
  const openCanteens = useMemo(() => canteenDayData.filter(c => !isCanteenClosed(c)), [canteenDayData]);
  const closedCanteens = useMemo(() => canteenDayData.filter(c => isCanteenClosed(c)), [canteenDayData]);


  // #6 — Lightbox image click handler using open canteen index
  const handleImageClick = useCallback((data: { canteenName: string }) => {
    const idx = openCanteens.findIndex(c => c.canteenName === data.canteenName);
    setLightboxIndex(idx >= 0 ? idx : 0);
  }, [openCanteens]);

  // Every viewport opens the action sheet: it is the route to voting and to
  // the canteen's building and hours, so it has to open regardless of width.
  const handleCardClick = useCallback((canteenName: string) => {
    const data = canteenDayData.find(c => c.canteenName === canteenName);
    setActionSheet({
      isOpen: true,
      canteenName,
      dishName: data?.mainDish?.dish || "",
      imagePath: data?.imagePath || "",
    });
  }, [canteenDayData]);



  if (!menuData) {
    return <LoadingScreen />;
  }

  return (
    <div className="app-wrapper">
      <AppHeader
        mode={mode}
        displayWeek={displayWeek}
        dayLabel={fullDayLabels[shownDay]}
        dateStr={dateStr}
        actions={{ onInfo: () => setInfoOpen(true) }}
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
      >
        <ErrorBoundary>
          <div className="cards-track" ref={trackRef}>
            {/*
              The day on screen and, while a change is under way, the day it is
              changing to. Both sit in this element's single grid cell; the
              neighbour is offset one width plus a gap by its class, and the
              track's own transform carries both. Keyed by day, so the
              neighbour becomes the current panel without being remounted.
            */}
            {/*
              The whole week, side by side: a native snapping scroller, so the
              browser itself carries the board at the screen's refresh rate.
              Keyed by day, so nothing remounts when the day changes.
            */}
            <div className="cards-board">
            {DAY_KEYS.map((_, day) => (
              <DayPanel
                key={`day-${day}`}
                day={day}
                data={allDaysData[day] ?? (day === selectedDay ? canteenDayData : [])}
                todayIndex={todayIndex}
                votes={voting.votes}
                maxVotes={maxVotes}
                onImageClick={handleImageClick}
                onCardClick={handleCardClick}
                inactive={day !== selectedDay}
                isInitial={day === selectedDay && !navigated}
              />
            ))}
            </div>
          </div>
        </ErrorBoundary>
      </main>

      {/* Day Selector */}
      <DaySelector
        fullDayLabels={fullDayLabels}
        dayLabelsData={dayLabelsData}
        selectedDay={previewDay ?? selectedDay}
        todayIndex={todayIndex}
        mode={mode}
        onDaySelect={handleDaySelect}
        onDayHover={preloadDay}
        cardsRef={scrollRef}
      />

      {/* Lazy: ~80 lines of static JSX and two inline SVGs for a panel almost
          nobody opens, plus its stylesheet. */}
      {infoOpen && (
        <Suspense fallback={null}>
          <InfoModal onClose={() => setInfoOpen(false)} />
        </Suspense>
      )}





      {/*
        Action sheet, with the 120Hz native GPU compositor transform.

        Not mobile-only: the sheet is the route to voting on every width. Every
        `.action-sheet` rule is top-level, capped at 440px and anchored to the
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
          voting.setVoteError(false);
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
            canVote={!!canVote}
            hasVoted={voting.hasVoted}
            isVoting={voting.isVoting}
            votedCanteen={voting.votedCanteen}
            voteSuccess={voting.voteSuccess}
            voteError={voting.voteError}
            onVote={voting.handleVote}
            onClose={closeSheet}
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
              closeRef={lightboxCloseRef}
            />
          </Suspense>
        )}

    </div>
  );
}
