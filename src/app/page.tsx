"use client";

import { useState, useEffect, useRef, useMemo } from "react";

// Types
interface Allergen { id: string; name: string; }
interface MenuItem { dish: string; allergens: Allergen[]; isMain: boolean; }
interface DayMenu { label: string; items: MenuItem[]; }
interface DayEntry { day: string; no: DayMenu; en: DayMenu; }
interface CanteenData { week: string; openingHours: string; menu: DayEntry[]; }
interface MenuData { scrapedAt: string; canteens: Record<string, CanteenData>; }

// Constants
const DAYS_NO = ["Man", "Tir", "Ons", "Tor", "Fre"];
const DAYS_EN = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const FULL_DAYS_NO = ["Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag"];
const FULL_DAYS_EN = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const DAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday"];

const ALLERGEN_COLORS: Record<string, string> = {
  Egg: "#FF9500", Fish: "#30B0C7", Gluten: "#FFCC00", Milk: "#8E8E93",
  Nuts: "#A05A2C", Peanuts: "#A05A2C", Celery: "#34C759", Mustard: "#FFCC00",
  "Sesame seeds": "#C7A000", Shellfish: "#FF3B30", Soya: "#5856D6",
  Sulphites: "#AF52DE", Molluscs: "#5AC8FA", Lupin: "#34C759"
};

const CANTEEN_ORDER = ["Eat the street", "Fresh4you", "Flow"];

const CANTEEN_IMAGE_SLUGS: Record<string, string> = {
  "Eat the street": "eat_the_street", "Fresh4you": "fresh4you", "Flow": "flow"
};

export default function Home() {
  const [menuData, setMenuData] = useState<MenuData | null>(null);
  const [lang, setLang] = useState<"no" | "en">("no");
  const [selectedDay, setSelectedDay] = useState(0);
  const [todayIndex, setTodayIndex] = useState(-1);
  const [allergenOpen, setAllergenOpen] = useState(false);
  const [lightbox, setLightbox] = useState({ isOpen: false, imageSrc: "", dishName: "", canteenName: "" });
  const [mounted, setMounted] = useState(false);
  const [votes, setVotes] = useState<Record<string, number>>({});
  const [voteModal, setVoteModal] = useState<{ isOpen: boolean; canteenName: string }>({ isOpen: false, canteenName: '' });
  const [hasVoted, setHasVoted] = useState(false);
  const [votedCanteen, setVotedCanteen] = useState('');
  const [isVoting, setIsVoting] = useState(false);
  const [dishOrigins, setDishOrigins] = useState<Record<string, { country: string; emoji: string }>>({});
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);
  const [swipeDirection, setSwipeDirection] = useState<'swipe-left' | 'swipe-right' | ''>('');
  const scrollRef = useRef<HTMLElement>(null);
  const votesLoadedRef = useRef(false);

  // Restore scroll position after mount and data load
  useEffect(() => {
    if (mounted && scrollRef.current) {
      const savedScroll = localStorage.getItem('canteenScrollPos');
      if (savedScroll !== null) {
        // Use a slight timeout to ensure DOM has fully painted the new height
        setTimeout(() => {
          if (scrollRef.current) scrollRef.current.scrollTop = parseInt(savedScroll, 10);
        }, 10);
      }
    }
  }, [mounted, menuData]);

  const handleScroll = (e: React.UIEvent<HTMLElement>) => {
    localStorage.setItem('canteenScrollPos', e.currentTarget.scrollTop.toString());
  };

  const minSwipeDistance = 50;

  const onTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;

    if (isLeftSwipe && selectedDay < 4) {
      setSwipeDirection('swipe-left');
      setSelectedDay(prev => prev + 1);
    }
    if (isRightSwipe && selectedDay > 0) {
      setSwipeDirection('swipe-right');
      setSelectedDay(prev => prev - 1);
    }
  };

  const handleDaySelect = (i: number) => {
    if (i > selectedDay) setSwipeDirection('swipe-left');
    else if (i < selectedDay) setSwipeDirection('swipe-right');
    else setSwipeDirection('');
    setSelectedDay(i);
  };

  useEffect(() => {
    const jsDay = new Date().getDay();
    const isWeekday = jsDay >= 1 && jsDay <= 5;
    const idx = isWeekday ? jsDay - 1 : -1;
    setTodayIndex(idx);
    // On weekends, show Friday (index 4) as the nearest weekday
    setSelectedDay(isWeekday ? jsDay - 1 : 4);

    fetch("/menu.json")
      .then(r => r.json())
      .then(menu => setMenuData(menu));

    fetch('/dish-origins.json')
      .then(r => r.ok ? r.json() : {})
      .then(data => setDishOrigins(data || {}))
      .catch(() => {});

    fetch('/api/attendance')
      .then(r => r.json())
      .then(data => {
        setVotes(data.canteens || {});
        votesLoadedRef.current = true;
      });

    setMounted(true);
    const todayKey = new Date().toISOString().split('T')[0];
    const voted = localStorage.getItem(`voted_${todayKey}`);
    if (voted) { setHasVoted(true); setVotedCanteen(voted); }
    const interval = setInterval(() => {
      fetch('/api/attendance').then(r => r.json()).then(data => setVotes(data.canteens || {}));
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => { if (e.key === "Escape") { setLightbox(prev => ({ ...prev, isOpen: false })); setVoteModal({ isOpen: false, canteenName: '' }); } };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, []);

  // Preload all images for all days so switching is instant, but defer non-active days
  useEffect(() => {
    if (!menuData) return;

    // Prioritize the current selected day to ensure it loads first
    const sortedDays = [...DAY_KEYS];
    if (selectedDay >= 0 && selectedDay < sortedDays.length) {
      const day = sortedDays[selectedDay];
      sortedDays.splice(selectedDay, 1);
      sortedDays.unshift(day);
    }

    // Load active day immediately
    const today = sortedDays[0];
    if (today) {
      CANTEEN_ORDER.forEach(name => {
        const slug = CANTEEN_IMAGE_SLUGS[name] || name.toLowerCase().replace(/\s+/g, "_");
        const img = new window.Image();
        img.src = `/images_nobg/${today}/${slug}.png`;
      });
    }

    // Defer loading the remaining days by 1.5 seconds to not block active day's images
    const timer = setTimeout(() => {
      sortedDays.slice(1).forEach(day => {
        CANTEEN_ORDER.forEach(name => {
          const slug = CANTEEN_IMAGE_SLUGS[name] || name.toLowerCase().replace(/\s+/g, "_");
          const img = new window.Image();
          img.src = `/images_nobg/${day}/${slug}.png`;
        });
      });
    }, 1500);

    return () => clearTimeout(timer);
  }, [menuData, selectedDay]);

  // Disable vertical scrolling when content fits viewport
  useEffect(() => {
    const checkScroll = () => {
      if (scrollRef.current) {
        const { scrollHeight, clientHeight } = scrollRef.current;
        // Only enable scroll when content genuinely overflows by more than 50px.
        // Large threshold absorbs iOS Safari rounding/safe-area discrepancies.
        if (scrollHeight > clientHeight + 50) {
          scrollRef.current.style.overflowY = 'auto';
          scrollRef.current.style.touchAction = 'pan-x pan-y';
        } else {
          scrollRef.current.style.overflowY = 'hidden';
          scrollRef.current.style.touchAction = 'pan-x';
        }
      }
    };

    const timeoutId = setTimeout(checkScroll, 50);
    window.addEventListener('resize', checkScroll);

    // Watch for internal DOM size changes dynamically
    const observer = new ResizeObserver(() => checkScroll());
    if (scrollRef.current) observer.observe(scrollRef.current);

    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('resize', checkScroll);
      observer.disconnect();
    };
  }, [mounted, menuData, selectedDay]);

  const dayLabels = lang === "no" ? DAYS_NO : DAYS_EN;
  const fullDayLabels = lang === "no" ? FULL_DAYS_NO : FULL_DAYS_EN;
  const dayKey = DAY_KEYS[selectedDay];
  // On weekends todayIndex is -1; use Friday (4) as the active day for voting
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

  const { monday, dateStr, dayLabelsData } = useMemo(() => {
    const selectedDate = new Date();
    const currentDayOfWeek = selectedDate.getDay();
    const mondayOffset = currentDayOfWeek === 0 ? -6 : 1 - currentDayOfWeek;
    const m = new Date(selectedDate);
    m.setDate(selectedDate.getDate() + mondayOffset);

    const t = new Date(m);
    t.setDate(m.getDate() + selectedDay);
    const dStr = t.toLocaleDateString(lang === "no" ? "nb-NO" : "en-GB", { day: "numeric", month: "long" });

    const labels = fullDayLabels.map((_, i) => {
      const dayDate = new Date(m);
      dayDate.setDate(m.getDate() + i);
      return `${dayDate.getDate().toString().padStart(2, "0")}.${(dayDate.getMonth() + 1).toString().padStart(2, "0")}`;
    });

    return { monday: m, dateStr: dStr, dayLabelsData: labels };
  }, [selectedDay, lang, fullDayLabels]);

  const canteenDayData = useMemo(() => {
    return sortedCanteens.map(([canteenName, canteen]) => {
      const dayEntry = canteen.menu.find(d => d.day.toLowerCase() === dayKey);
      const items = lang === "no" ? dayEntry?.no?.items : dayEntry?.en?.items;
      const mainDish = items?.find(i => i.isMain);
      const sideDishes = items?.filter(i => !i.isMain).slice(0, 2) || [];
      const mainAllergens = mainDish?.allergens || [];
      const imageSlug = CANTEEN_IMAGE_SLUGS[canteenName] || canteenName.toLowerCase().replace(/\s+/g, "_");
      const imagePath = `/images_nobg/${dayKey}/${imageSlug}.png`;
      const highResImagePath = `/images/${dayKey}/${imageSlug}.png`;
      const canteenWeekNum = parseInt(canteen.week.match(/\d+/)?.[0] || "0", 10);
      const isOutdated = canteenWeekNum !== currentWeek;

      const enMainDish = (dayEntry?.en?.items || []).find(i => i.isMain);
      const origin = dishOrigins[enMainDish?.dish || ''] ?? null;

      return {
        canteenName,
        canteen,
        dayEntry,
        items,
        mainDish,
        sideDishes,
        mainAllergens,
        imageSlug,
        imagePath,
        highResImagePath,
        isOutdated,
        canteenWeekNum,
        origin
      };
    });
  }, [sortedCanteens, dayKey, lang, dishOrigins]);

  const dayAllergens = useMemo(() => Array.from(new Map(
    canteenDayData.flatMap(({ items }) => {
      return items?.flatMap(i => i.allergens.map(a => [a.name, a])) || [];
    })
  ).values()).sort((a, b) => a.name.localeCompare(b.name)), [canteenDayData]);

  if (!menuData || !mounted) {
    return <div className="app-wrapper" style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}><span style={{ color: "#999" }}>Loading...</span></div>;
  }

  return (
    <div className="app-wrapper">
      {/* Header */}
      <header className="app-header">
        <div className="hero-inline">
          <h1 className="hero-title">{lang === "no" ? "Dagens" : "Today's"} <span>{lang === "no" ? "Lunsj" : "Lunch"}</span></h1>
          <p className="hero-subtitle">{weekLabel} • {fullDayLabels[selectedDay]} {dateStr}</p>
        </div>
        <div className="lang-switcher">
          <button className={lang === "no" ? "lang-btn active" : "lang-btn"} onClick={() => setLang("no")}>NO</button>
          <button className={lang === "en" ? "lang-btn active" : "lang-btn"} onClick={() => setLang("en")}>EN</button>
        </div>
      </header>

      {/* Allergen Section */}
      {dayAllergens.length > 0 && (
        <div className="allergen-section" onClick={e => e.stopPropagation()}>
          <div className="allergen-toggle" onClick={e => { e.stopPropagation(); setAllergenOpen(!allergenOpen); }}>
            <span className="allergen-toggle-icon">⚠️</span>
            <span className="allergen-toggle-text">{dayAllergens.length} {lang === "no" ? (dayAllergens.length === 1 ? "allergen i dag" : "allergener i dag") : (dayAllergens.length === 1 ? "allergen today" : "allergens today")}</span>
            <span className={`allergen-toggle-arrow ${allergenOpen ? "open" : ""}`}>▼</span>
          </div>
          {allergenOpen && (
            <div className="allergen-panel">
              <div className="allergen-panel-title">{lang === "no" ? "Allergener i dagens meny" : "Allergens in today's menu"}</div>
              <div className="allergen-grid">
                {dayAllergens.map((a, idx) => (
                  <div key={a.id} className="allergen-item" style={{ animationDelay: `${idx * 40}ms` }}>
                    <span className="allergen-item-dot" style={{ background: ALLERGEN_COLORS[a.name] || "#8E8E93" }}>{a.name.charAt(0)}</span>
                    <span className="allergen-item-name">{a.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Cards */}
      <main className="cards-container" ref={scrollRef} onScroll={handleScroll} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
        <div key={selectedDay} className={`cards-animated-wrapper ${swipeDirection}`}>
          {canteenDayData.map(({
            canteenName,
            canteen,
            items,
            mainDish,
            sideDishes,
            mainAllergens,
            imagePath,
            highResImagePath,
            isOutdated,
            canteenWeekNum,
            origin
          }, cardIdx) => {
            return (
              <article key={canteenName} className={`food-card${selectedDay === activeDayIndex ? ' voteable' : ''}${isOutdated ? ' outdated' : ''}`} style={{ animationDelay: `${cardIdx * 75}ms` }} onClick={selectedDay === activeDayIndex ? () => setVoteModal({ isOpen: true, canteenName }) : undefined}>
                <div className="card-image-wrapper" onClick={e => { e.stopPropagation(); mainDish && setLightbox({ isOpen: true, imageSrc: imagePath, dishName: mainDish.dish, canteenName }); }}>
                  <div className="card-image-circle">
                    <img src={imagePath} alt={mainDish?.dish || "Matrett"} className="food-image" />
                  </div>
                  {isOutdated && (
                    <div className="stale-image-badge">
                      {lang === "no" ? `Uke ${canteenWeekNum}` : `Wk ${canteenWeekNum}`}
                    </div>
                  )}
                  <span className="click-hint">{lang === "no" ? "Klikk for større" : "Click to enlarge"}</span>
                  {origin && (
                    <div className="origin-stamp" data-country={origin.country}>
                      <span className="origin-flag">{origin.emoji}</span>
                    </div>
                  )}
                </div>
                <div className="card-content">
                  <div className="card-header">
                    <div className="canteen-name">{canteenName}</div>
                    <h3 className="dish-name">{mainDish?.dish || (lang === "no" ? "Ingen meny" : "No menu")}</h3>
                  </div>

                  <div className="dish-meta-row">
                    <div className="allergens-row">
                      {mainAllergens.length > 0 && mainAllergens.map((a, aIdx) => (
                        <span
                          key={a.id}
                          className="allergen-chip"
                          style={{
                            color: ALLERGEN_COLORS[a.name] || "#8E8E93",
                            background: `${ALLERGEN_COLORS[a.name] || "#8E8E93"}1a`,
                            borderColor: `${ALLERGEN_COLORS[a.name] || "#8E8E93"}44`,
                            animationDelay: `${aIdx * 50}ms`,
                          }}
                        >
                          {a.name}
                        </span>
                      ))}
                    </div>
                    <div className="info-badges">
                      {selectedDay === activeDayIndex && (votes[canteenName] ?? 0) > 0 && (
                        <div className={`vote-badge${(votes[canteenName] ?? 0) === maxVotes ? ' leader' : ''} vote-badge-pop`}>
                          {(votes[canteenName] ?? 0) === maxVotes && <>🏆 </>}{votes[canteenName]} {lang === 'no' ? (votes[canteenName] === 1 ? 'stemme' : 'stemmer') : (votes[canteenName] === 1 ? 'vote' : 'votes')}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                {isOutdated && (
                  <div className="stale-banner">
                    <span className="stale-banner-icon">⏰</span>
                    <div className="stale-banner-text">
                      <strong>{lang === "no" ? "Ikke oppdatert" : "Not updated"}</strong>
                      <span>{lang === "no" ? `Viser meny for uke ${canteenWeekNum}` : `Showing menu from week ${canteenWeekNum}`}</span>
                    </div>
                  </div>
                )}
                <div className="card-bottom">
                  <div className="side-dishes-title">{lang === "no" ? "Andre retter" : "Other dishes"}</div>
                  <div className="side-dish-list">
                    {sideDishes.length > 0 ? sideDishes.map((item, idx) => (
                      <div key={idx} className="side-dish-item">
                        <span className="side-dish-text">{item.dish}</span>
                        {item.allergens.length > 0 && <span className="side-allergens">{item.allergens.map(a => a.name.charAt(0)).join("")}</span>}
                      </div>
                    )) : <div className="side-dish-item" style={{ justifyContent: "center", color: "var(--text-muted)" }}>{lang === "no" ? "Ingen andre retter" : "No other dishes"}</div>}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </main>

      {/* Day Selector */}
      <nav className="day-bar">
        <div className="day-selector">
          {fullDayLabels.map((dayName, i) => {
            const dateLabel = dayLabelsData[i];
            return (
              <button key={i} className={`day-btn ${selectedDay === i ? "active" : ""} ${i === todayIndex ? "today" : ""}`} onClick={() => handleDaySelect(i)}>
                <span className="day-label-name">{dayName}</span>
                <span className="day-label-date">{i === todayIndex ? (lang === "no" ? "I dag" : "Today") : dateLabel}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Credit */}
      <div className="credit-badge">Made by Tom Hoel @ Telenor Finance</div>

      {/* Feedback */}
      <a href="mailto:tom.chamkrai.hoel@telenor.no?subject=Feedback%20on%20Canteen%20App" className="feedback-btn" title={lang === "no" ? "Send tilbakemelding" : "Send feedback"}>
        <span className="feedback-icon">✉️</span>
        <span className="feedback-text">{lang === "no" ? "Tilbakemelding" : "Feedback"}</span>
      </a>

      {/* Vote Modal */}
      {voteModal.isOpen && (
        <div className="vote-modal-overlay" onClick={() => setVoteModal({ isOpen: false, canteenName: '' })}>
          <div className="vote-modal" onClick={e => e.stopPropagation()}>
            <h3 className="vote-modal-title">{voteModal.canteenName}</h3>
            {!hasVoted ? (
              <>
                <p className="vote-modal-subtitle">{lang === 'no' ? 'Skal du dit i dag?' : 'Are you going today?'}</p>
                <button
                  className="vote-btn"
                  disabled={isVoting}
                  onClick={async () => {
                    setIsVoting(true);
                    const res = await fetch('/api/attendance', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ canteenName: voteModal.canteenName, action: 'add' }),
                    });
                    const data = await res.json();
                    setVotes(data.canteens || {});
                    const todayKey = new Date().toISOString().split('T')[0];
                    localStorage.setItem(`voted_${todayKey}`, voteModal.canteenName);
                    setVotedCanteen(voteModal.canteenName);
                    setHasVoted(true);
                    setIsVoting(false);
                  }}
                >
                  {isVoting ? '...' : (lang === 'no' ? 'Jeg stemmer på denne! 🙋' : "I vote for this! 🙋")}
                </button>
                <button className="vote-cancel" onClick={() => setVoteModal({ isOpen: false, canteenName: '' })}>
                  {lang === 'no' ? 'Avbryt' : 'Cancel'}
                </button>
              </>
            ) : (
              <>
                <p className="vote-modal-subtitle">{lang === 'no' ? 'Hvem spiser hvor i dag?' : "Who's going where today?"}</p>
                {sortedCanteens.map(([name]) => (
                  <div key={name} className={`vote-count-row${name === votedCanteen ? ' voted' : ''}${(votes[name] ?? 0) > 0 && (votes[name] ?? 0) === maxVotes ? ' leader' : ''}`}>
                    <span>{name}</span>
                    <span className="vote-count-number">{votes[name] ?? 0}</span>
                  </div>
                ))}
                <button className="vote-cancel" onClick={() => setVoteModal({ isOpen: false, canteenName: '' })}>
                  {lang === 'no' ? 'Lukk' : 'Close'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightbox.isOpen && (
        <div className="lightbox-overlay" onClick={() => setLightbox(prev => ({ ...prev, isOpen: false }))}>
          <div className="lightbox-content" onClick={e => e.stopPropagation()}>
            <button className="lightbox-close" onClick={() => setLightbox(prev => ({ ...prev, isOpen: false }))}>×</button>
            <div className="lightbox-image-container">
              <img src={lightbox.imageSrc} alt={lightbox.dishName} className="lightbox-image" />
            </div>
            <div className="lightbox-info">
              <p className="lightbox-canteen">{lightbox.canteenName}</p>
              <h2 className="lightbox-dish-name">{lightbox.dishName}</h2>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
