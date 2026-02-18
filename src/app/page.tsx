"use client";

import { useState, useEffect } from "react";

// Types
interface Allergen { id: string; name: string; }
interface MenuItem { dish: string; allergens: Allergen[]; isMain: boolean; }
interface DayMenu { label: string; items: MenuItem[]; }
interface DayEntry { day: string; no: DayMenu; en: DayMenu; }
interface CanteenData { week: string; openingHours: string; menu: DayEntry[]; }
interface MenuData { scrapedAt: string; canteens: Record<string, CanteenData>; }
interface AttendanceData { date: string; canteens: Record<string, number>; }

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
  
  // Attendance states
  const [attendance, setAttendance] = useState<AttendanceData | null>(null);
  const [userVotes, setUserVotes] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const jsDay = new Date().getDay();
    const isWeekday = jsDay >= 1 && jsDay <= 5;
    const idx = isWeekday ? jsDay - 1 : -1;
    setTodayIndex(idx);
    // On weekends, show Friday (index 4) as the nearest weekday
    setSelectedDay(isWeekday ? jsDay - 1 : 4);
    fetch("/menu.json").then(r => r.json()).then(setMenuData);
    setMounted(true);
  }, []);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setLightbox(prev => ({ ...prev, isOpen: false })); };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, []);

  // Fetch attendance data
  useEffect(() => {
    if (!mounted) return;
    
    const fetchAttendance = async () => {
      try {
        const response = await fetch('/api/attendance');
        if (response.ok) {
          const data = await response.json();
          setAttendance(data);
        }
      } catch (error) {
        console.error('Failed to fetch attendance:', error);
      }
    };
    
    // Load user votes from localStorage
    const today = new Date().toISOString().split('T')[0];
    const savedVotes = localStorage.getItem(`votes_${today}`);
    if (savedVotes) {
      setUserVotes(JSON.parse(savedVotes));
    }
    
    fetchAttendance();
    
    // Poll for updates every 30 seconds
    const interval = setInterval(fetchAttendance, 30000);
    return () => clearInterval(interval);
  }, [mounted]);

  // Preload all images for all days so switching is instant
  useEffect(() => {
    if (!menuData) return;

    // Prioritize the current selected day to ensure it loads first
    const sortedDays = [...DAY_KEYS];
    if (selectedDay >= 0 && selectedDay < sortedDays.length) {
      const day = sortedDays[selectedDay];
      sortedDays.splice(selectedDay, 1);
      sortedDays.unshift(day);
    }

    sortedDays.forEach(day => {
      CANTEEN_ORDER.forEach(name => {
        const slug = CANTEEN_IMAGE_SLUGS[name] || name.toLowerCase().replace(/\s+/g, "_");
        const img = new window.Image();
        img.src = `/images_nobg/${day}/${slug}.png`;
      });
    });
  }, [menuData, selectedDay]);

  // Toggle attendance for a canteen
  const toggleAttendance = async (canteenName: string) => {
    const isGoing = userVotes[canteenName];
    const action = isGoing ? 'remove' : 'add';
    
    try {
      const response = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canteenName, action })
      });
      
      if (response.ok) {
        const data = await response.json();
        setAttendance(data);
        
        // Update local state
        const newVotes = { ...userVotes, [canteenName]: !isGoing };
        setUserVotes(newVotes);
        
        // Save to localStorage
        const today = new Date().toISOString().split('T')[0];
        localStorage.setItem(`votes_${today}`, JSON.stringify(newVotes));
      }
    } catch (error) {
      console.error('Failed to toggle attendance:', error);
    }
  };

  if (!menuData || !mounted) {
    return <div className="app-wrapper" style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}><span style={{ color: "#999" }}>Loading...</span></div>;
  }

  const dayLabels = lang === "no" ? DAYS_NO : DAYS_EN;
  const fullDayLabels = lang === "no" ? FULL_DAYS_NO : FULL_DAYS_EN;
  const dayKey = DAY_KEYS[selectedDay];

  const sortedCanteens = CANTEEN_ORDER
    .filter(name => menuData.canteens[name])
    .map(name => [name, menuData.canteens[name]] as [string, CanteenData]);

  const weekLabel = sortedCanteens[0]?.[1].week || "";
  const selectedDate = new Date();
  const currentDayOfWeek = selectedDate.getDay();
  const mondayOffset = currentDayOfWeek === 0 ? -6 : 1 - currentDayOfWeek;
  const monday = new Date(selectedDate);
  monday.setDate(selectedDate.getDate() + mondayOffset);
  const target = new Date(monday);
  target.setDate(monday.getDate() + selectedDay);
  const dateStr = target.toLocaleDateString(lang === "no" ? "nb-NO" : "en-GB", { day: "numeric", month: "long" });

  const dayAllergens = Array.from(new Map(
    sortedCanteens.flatMap(([, c]) => {
      const entry = c.menu.find(d => d.day.toLowerCase() === dayKey);
      const items = lang === "no" ? entry?.no?.items : entry?.en?.items;
      return items?.flatMap(i => i.allergens.map(a => [a.name, a])) || [];
    })
  ).values()).sort((a, b) => a.name.localeCompare(b.name));

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
                {dayAllergens.map(a => (
                  <div key={a.id} className="allergen-item">
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
      <main className="cards-container">
        {sortedCanteens.map(([canteenName, canteen]) => {
          const dayEntry = canteen.menu.find(d => d.day.toLowerCase() === dayKey);
          const items = lang === "no" ? dayEntry?.no?.items : dayEntry?.en?.items;
          const mainDish = items?.find(i => i.isMain);
          const sideDishes = items?.filter(i => !i.isMain).slice(0, 2) || [];
          const mainAllergens = mainDish?.allergens || [];
          const imageSlug = CANTEEN_IMAGE_SLUGS[canteenName] || canteenName.toLowerCase().replace(/\s+/g, "_");
          const imagePath = `/images_nobg/${dayKey}/${imageSlug}.png`;
          const isFeatured = canteenName === "Eat the street";

          return (
            <article key={canteenName} className={`food-card ${isFeatured ? "featured" : ""}`}>
              {isFeatured && <div className="popular-badge">Popular</div>}
              <div className="card-image-wrapper" onClick={e => { e.stopPropagation(); mainDish && setLightbox({ isOpen: true, imageSrc: imagePath, dishName: mainDish.dish, canteenName }); }}>
                <div className="card-image-circle">
                  <img src={imagePath} alt={mainDish?.dish || "Matrett"} className="food-image" />
                </div>
                <span className="click-hint">{lang === "no" ? "Klikk for større" : "Click to enlarge"}</span>
              </div>
              <div className="card-content">
                <div className="card-header">
                  <div className="canteen-name">{canteenName} <span className="week-label">({lang === "no" ? "Uke" : "Week"} {canteen.week.match(/\d+/)?.[0] || ""})</span></div>
                  <h3 className="dish-name">{mainDish?.dish || (lang === "no" ? "Ingen meny" : "No menu")}</h3>
                  <div className="hours-badge">{canteen.openingHours}</div>
                </div>
                {mainAllergens.length > 0 && (
                  <div className="allergens-row">
                    {mainAllergens.map(a => (
                      <span key={a.id} className="allergen-badge" style={{ background: ALLERGEN_COLORS[a.name] || "#8E8E93" }} title={a.name}>{a.name.charAt(0)}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="card-bottom">
                <div className="side-dishes-wrapper">
                  <div className="side-dishes-section">
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
                  
                  {/* Mobile attendance button */}
                  {selectedDay === todayIndex && (
                    <div className="attendance-section-mobile">
                      <button 
                        className={`attendance-btn ${userVotes[canteenName] ? 'active' : ''}`}
                        onClick={() => toggleAttendance(canteenName)}
                      >
                        {userVotes[canteenName] ? "✓ " : ""}{lang === "no" ? "Jeg går!" : "I'm going!"}
                      </button>
                      {attendance && attendance.canteens[canteenName] > 0 && (
                        <span className="attendance-count">
                          {attendance.canteens[canteenName]} {lang === "no" ? "går" : "going"}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </main>

      {/* Day Selector */}
      <nav className="day-bar">
        <div className="day-selector">
          {fullDayLabels.map((dayName, i) => {
            const dayDate = new Date(monday);
            dayDate.setDate(monday.getDate() + i);
            const dateLabel = `${dayDate.getDate().toString().padStart(2, "0")}.${(dayDate.getMonth() + 1).toString().padStart(2, "0")}`;
            return (
              <button key={i} className={`day-btn ${selectedDay === i ? "active" : ""} ${i === todayIndex ? "today" : ""}`} onClick={() => setSelectedDay(i)}>
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

      {/* Lightbox */}
      {lightbox.isOpen && (
        <div className="lightbox-overlay" onClick={() => setLightbox(prev => ({ ...prev, isOpen: false }))}>
          <button className="lightbox-close" onClick={() => setLightbox(prev => ({ ...prev, isOpen: false }))}>×</button>
          <div className="lightbox-content" onClick={e => e.stopPropagation()}>
            <div className="lightbox-image-container">
              <img src={lightbox.imageSrc} alt={lightbox.dishName} className="lightbox-image" />
            </div>
            <h2 className="lightbox-dish-name">{lightbox.dishName}</h2>
            <p className="lightbox-canteen">{lightbox.canteenName}</p>
          </div>
        </div>
      )}
    </div>
  );
}
