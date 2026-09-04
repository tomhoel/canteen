"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  X,
  Plus,
  Minus,
  RotateCcw,
  Compass,
  MapPin,
  Clock,
  Utensils,
  Sparkles,
  ChevronRight,
} from "lucide-react";
import {
  CANTEEN_LOCATIONS,
  getCanteenMetadata,
  getLocationStatus,
} from "@/lib/constants";
import type { MenuData } from "@/lib/types";
import "@/styles/campus-map.css";

interface CampusMapModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTargetId?: string | null;
  menuData?: MenuData | null;
  selectedDayIndex: number;
  lang?: "no" | "en";
  onSelectCanteen?: (canteenKey: string) => void;
}

type FilterCategory = "all" | "canteens" | "cafes";
type LayerMode = "blueprint" | "satellite";

export default function CampusMapModal({
  isOpen,
  onClose,
  initialTargetId,
  menuData,
  selectedDayIndex,
  lang = "no",
  onSelectCanteen,
}: CampusMapModalProps) {
  const [layer, setLayer] = useState<LayerMode>("blueprint");
  const [filter, setFilter] = useState<FilterCategory>("all");
  const [selectedId, setSelectedId] = useState<string>(
    initialTargetId ? getCanteenMetadata(initialTargetId).id : "street"
  );

  // Pan & Zoom state
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; panX: number; panY: number }>({
    x: 0,
    y: 0,
    panX: 0,
    panY: 0,
  });

  const viewportRef = useRef<HTMLDivElement>(null);

  // Update selected location if initialTargetId changes
  useEffect(() => {
    if (initialTargetId) {
      const meta = getCanteenMetadata(initialTargetId);
      setSelectedId(meta.id);
    }
  }, [initialTargetId]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Filtered locations
  const locations = CANTEEN_LOCATIONS.filter((loc) => {
    if (filter === "canteens") return loc.type === "canteen" || loc.type === "dinner";
    if (filter === "cafes") return loc.type === "cafe" || loc.type === "bakery";
    return true;
  });

  const activeLocation =
    CANTEEN_LOCATIONS.find((l) => l.id === selectedId) || CANTEEN_LOCATIONS[0];
  const activeStatus = getLocationStatus(activeLocation);

  // Today's main dish for the active canteen if available
  const todayDish = (() => {
    if (!menuData || !activeLocation.hasMenu) return null;
    const canteenData = menuData.canteens[activeLocation.canonicalKey];
    if (!canteenData || !canteenData.menu) return null;
    const dayEntry = canteenData.menu[selectedDayIndex];
    if (!dayEntry) return null;
    const items = dayEntry.no?.items || dayEntry.en?.items || [];
    return items.find((i) => i.isMain)?.dish || items[0]?.dish || null;
  })();

  // Zoom controls
  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 0.35, 2.6));
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 0.35, 0.85));
  const handleReset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // Center on a specific location
  const handleSelectLocation = useCallback((id: string) => {
    setSelectedId(id);
    const loc = CANTEEN_LOCATIONS.find((l) => l.id === id);
    if (!loc) return;

    // Pan smoothly towards location
    const targetX = (50 - loc.coordinates.x) * 3.5;
    const targetY = (50 - loc.coordinates.y) * 2.8;
    setPan({
      x: Math.max(-180, Math.min(180, targetX)),
      y: Math.max(-140, Math.min(140, targetY)),
    });
  }, []);

  // Pointer / touch drag handlers
  const handlePointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest(".campus-pin-holder")) return;
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    const maxBound = 260 * zoom;
    setPan({
      x: Math.max(-maxBound, Math.min(maxBound, dragStartRef.current.panX + dx)),
      y: Math.max(-maxBound, Math.min(maxBound, dragStartRef.current.panY + dy)),
    });
  };

  const handlePointerUp = () => {
    setIsDragging(false);
  };

  if (!isOpen) return null;

  return (
    <div
      className="campus-map-overlay"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="campus-map-modal"
        role="dialog"
        aria-modal="true"
        aria-label={lang === "no" ? "Kart over kantinene" : "Campus canteen map"}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="campus-map-header">
          <div className="campus-map-title-group">
            <span className="campus-map-eyebrow">
              <Compass size={13} strokeWidth={2.4} />
              Snarøyveien 30 &bull; Fornebu
            </span>
            <h2 className="campus-map-title">
              {lang === "no" ? "Hvor er kantinene?" : "Where are the canteens?"}
            </h2>
          </div>

          <div className="campus-map-header-actions">
            {/* Layer Switcher: Blueprint vs Satellite */}
            <div className="campus-layer-switch" role="group" aria-label="Velg kartvisning">
              <button
                type="button"
                className={`campus-layer-btn${layer === "blueprint" ? " active" : ""}`}
                onClick={() => setLayer("blueprint")}
              >
                📐 {lang === "no" ? "Tegning" : "Blueprint"}
              </button>
              <button
                type="button"
                className={`campus-layer-btn${layer === "satellite" ? " active" : ""}`}
                onClick={() => setLayer("satellite")}
              >
                🛰️ {lang === "no" ? "Flyfoto" : "Aerial"}
              </button>
            </div>

            <button
              type="button"
              className="campus-map-close-btn"
              onClick={onClose}
              aria-label={lang === "no" ? "Lukk kart" : "Close map"}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="campus-map-body">
          {/* Main Map Viewport */}
          <div
            className="campus-map-viewport"
            ref={viewportRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            {/* Zoom Controls */}
            <div className="campus-map-controls">
              <div className="campus-ctrl-group">
                <button
                  type="button"
                  className="campus-ctrl-btn"
                  onClick={handleZoomIn}
                  title="Zoom inn"
                  aria-label="Zoom inn"
                >
                  <Plus size={16} />
                </button>
                <button
                  type="button"
                  className="campus-ctrl-btn"
                  onClick={handleZoomOut}
                  title="Zoom ut"
                  aria-label="Zoom ut"
                >
                  <Minus size={16} />
                </button>
              </div>
              <div className="campus-ctrl-group">
                <button
                  type="button"
                  className="campus-ctrl-btn"
                  onClick={handleReset}
                  title="Nullstill visning"
                  aria-label="Nullstill visning"
                >
                  <RotateCcw size={14} />
                </button>
              </div>
            </div>

            {/* Quick Filter Bar */}
            <div className="campus-filter-bar">
              <button
                type="button"
                className={`campus-filter-chip${filter === "all" ? " active" : ""}`}
                onClick={() => setFilter("all")}
              >
                {lang === "no" ? "Alle steder (7)" : "All spots (7)"}
              </button>
              <button
                type="button"
                className={`campus-filter-chip${filter === "canteens" ? " active" : ""}`}
                onClick={() => setFilter("canteens")}
              >
                🍽️ {lang === "no" ? "Kantiner (3)" : "Canteens (3)"}
              </button>
              <button
                type="button"
                className={`campus-filter-chip${filter === "cafes" ? " active" : ""}`}
                onClick={() => setFilter("cafes")}
              >
                ☕ {lang === "no" ? "Kafé & Bakeri (4)" : "Café & Bakery (4)"}
              </button>
            </div>

            {/* Canvas with dynamic transform */}
            <div
              className="campus-map-canvas"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transition: isDragging ? "none" : "transform 0.28s cubic-bezier(0.16, 1, 0.3, 1)",
              }}
            >
              {layer === "satellite" ? (
                /* Satellite Aerial Layer (optimized WebP) */
                <img
                  src="/images/fornebu-campus.webp"
                  alt="Flyfoto over Telenor Fornebu, Snarøyveien 30"
                  className="campus-map-satellite-img"
                  draggable={false}
                />
              ) : (
                /* Crisp Architectural Vector Blueprint Layer */
                <svg
                  className="campus-blueprint-svg"
                  viewBox="0 0 1000 760"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <defs>
                    <pattern
                      id="plaza-grid"
                      width="20"
                      height="20"
                      patternUnits="userSpaceOnUse"
                    >
                      <line
                        x1="0"
                        y1="0"
                        x2="20"
                        y2="20"
                        stroke="rgba(0,0,0,0.04)"
                        strokeWidth="1"
                      />
                    </pattern>
                  </defs>

                  {/* Campus Ground */}
                  <rect width="1000" height="760" className="bp-ground" />

                  {/* Landscaped Green Areas & Courtyards */}
                  <path
                    d="M40,40 Q160,20 280,50 Q260,160 180,220 Z"
                    className="bp-grass"
                  />
                  <path
                    d="M480,20 Q660,10 740,30 Q700,120 540,110 Z"
                    className="bp-grass"
                  />
                  <path
                    d="M850,40 Q960,100 960,240 Q860,280 840,190 Z"
                    className="bp-grass"
                  />
                  <path
                    d="M40,580 Q120,740 320,740 Q280,620 160,560 Z"
                    className="bp-grass"
                  />
                  <path
                    d="M440,730 Q680,740 820,680 Q760,600 520,610 Z"
                    className="bp-grass"
                  />
                  <path
                    d="M840,480 Q980,540 940,720 Q820,720 780,580 Z"
                    className="bp-grass"
                  />

                  {/* Roads & Pathways */}
                  <path
                    d="M10,240 Q120,220 190,260 T230,480 Q120,530 20,580"
                    fill="none"
                    className="bp-road"
                  />
                  <path
                    d="M850,260 Q960,320 980,480 T900,640"
                    fill="none"
                    className="bp-road"
                  />

                  {/* Central Pedestrian Plaza (Telenor-torget) */}
                  <polygon
                    points="240,440 600,280 860,370 780,470 410,580 230,510"
                    className="bp-plaza"
                  />
                  <polygon
                    points="240,440 600,280 860,370 780,470 410,580 230,510"
                    fill="url(#plaza-grid)"
                  />

                  {/* Diagonal Plaza Design Accents */}
                  <line x1="280" y1="460" x2="360" y2="430" className="bp-plaza-pattern" />
                  <line x1="330" y1="480" x2="420" y2="440" className="bp-plaza-pattern" />
                  <line x1="390" y1="500" x2="490" y2="460" className="bp-plaza-pattern" />
                  <line x1="460" y1="510" x2="570" y2="460" className="bp-plaza-pattern" />
                  <line x1="530" y1="510" x2="650" y2="450" className="bp-plaza-pattern" />
                  <line x1="600" y1="500" x2="720" y2="430" className="bp-plaza-pattern" />

                  {/* Water Mirror in Plaza */}
                  <ellipse cx="520" cy="420" rx="34" ry="18" fill="#c7d2fe" opacity="0.75" />

                  {/* ──────────────────────────────────────────────────────────
                      NORTH BOULEVARD SPINE & PAVILIONS (Bygg Expo, C, D, E, F)
                      ────────────────────────────────────────────────────────── */}
                  {/* North Spine */}
                  <path
                    d="M210,380 Q510,250 860,250 L840,290 Q510,290 230,420 Z"
                    className="bp-spine"
                  />

                  {/* Bygg Expo / A (North-East) */}
                  <polygon
                    points="830,120 920,180 880,260 810,210"
                    className={`bp-building${activeLocation.id === "expo" ? " bp-building-active" : ""}`}
                    onClick={() => handleSelectLocation("expo")}
                  />
                  <text x="860" y="195" className="bp-building-label">Expo / A</text>

                  {/* Bygg C/D (North-East) */}
                  <polygon
                    points="720,60 800,90 770,230 690,210"
                    className={`bp-building${activeLocation.id === "fresh4you" ? " bp-building-active" : ""}`}
                    onClick={() => handleSelectLocation("fresh4you")}
                  />
                  <text x="745" y="145" className="bp-building-label">C / D</text>

                  {/* Bygg C & Bakern (North) */}
                  <polygon
                    points="560,90 640,110 620,240 540,230"
                    className={`bp-building${activeLocation.id === "bakern" ? " bp-building-active" : ""}`}
                    onClick={() => handleSelectLocation("bakern")}
                  />
                  <text x="590" y="165" className="bp-building-label">C (Bakern)</text>

                  {/* Bygg E / F (North-West) */}
                  <polygon
                    points="370,160 450,190 430,310 350,290"
                    className="bp-building"
                  />
                  <text x="400" y="240" className="bp-building-label">E / F</text>

                  {/* ──────────────────────────────────────────────────────────
                      SOUTH BOULEVARD SPINE & PAVILIONS (Bygg G, H, J, K, M)
                      ────────────────────────────────────────────────────────── */}
                  {/* South Spine */}
                  <path
                    d="M120,530 Q460,590 790,470 L770,510 Q450,630 110,570 Z"
                    className="bp-spine"
                  />

                  {/* Bygg J / K (South-West) -> Eat The Street */}
                  <polygon
                    points="140,580 260,560 300,700 180,720"
                    className={`bp-building${activeLocation.id === "street" || activeLocation.id === "dinner" ? " bp-building-active" : ""}`}
                    onClick={() => handleSelectLocation("street")}
                  />
                  <text x="220" y="640" className="bp-building-label">J / K</text>
                  <text x="220" y="660" className="bp-zone-label">Eat The Street</text>

                  {/* Bygg G / H (Center-South) -> Hot Spot */}
                  <polygon
                    points="370,560 460,540 480,680 390,700"
                    className={`bp-building${activeLocation.id === "hotspot" ? " bp-building-active" : ""}`}
                    onClick={() => handleSelectLocation("hotspot")}
                  />
                  <text x="425" y="620" className="bp-building-label">G / H</text>

                  {/* Bygg M (South-East) -> Kantine M & Cafe M */}
                  <polygon
                    points="640,510 740,490 770,640 670,660"
                    className={`bp-building${activeLocation.id === "m" || activeLocation.id === "cafem" ? " bp-building-active" : ""}`}
                    onClick={() => handleSelectLocation("m")}
                  />
                  <text x="705" y="575" className="bp-building-label">Bygg M</text>
                  <text x="705" y="595" className="bp-zone-label">Kantine & Kafé</text>

                  {/* Central Glass Connector in Plaza */}
                  <polygon
                    points="380,430 540,360 560,400 400,470"
                    className="bp-glass-bridge"
                  />
                  <text x="470" y="415" className="bp-zone-label">Torget</text>
                </svg>
              )}

              {/* Interactive Location Pins */}
              {locations.map((loc) => {
                const isActive = loc.id === selectedId;
                const status = getLocationStatus(loc);

                return (
                  <div
                    key={loc.id}
                    className={`campus-pin-holder${isActive ? " active" : ""}`}
                    style={{
                      left: `${loc.coordinates.x}%`,
                      top: `${loc.coordinates.y}%`,
                    }}
                    onClick={() => handleSelectLocation(loc.id)}
                  >
                    <div
                      className="campus-pin"
                      style={{
                        borderColor: isActive ? loc.color : undefined,
                        color: isActive ? loc.color : undefined,
                      }}
                    >
                      <div className={`campus-pin-indicator ${status.badgeVariant}`}>
                        {status.isOpen && (
                          <div
                            className="campus-pin-pulse"
                            style={{ borderColor: loc.color }}
                          />
                        )}
                      </div>

                      <div className="campus-pin-label">
                        <span className="campus-pin-name">{loc.shortName}</span>
                        <span className="campus-pin-sub">{loc.buildingShort}</span>
                      </div>
                    </div>
                    <div className="campus-pin-arrow" />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right/Bottom Side Panel: Location Detail Drawer */}
          <aside className="campus-detail-panel">
            <div className="campus-detail-inner">
              <div className="campus-detail-kicker">
                <span
                  className="campus-building-badge"
                  style={{
                    backgroundColor: activeLocation.badgeBg,
                    borderColor: activeLocation.badgeBorder,
                    color: activeLocation.color,
                  }}
                >
                  <MapPin size={12} strokeWidth={2.4} />
                  {activeLocation.building} &bull; {activeLocation.floor}
                </span>

                <span className={`campus-status-pill ${activeStatus.badgeVariant}`}>
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      backgroundColor: "currentColor",
                    }}
                  />
                  {activeStatus.statusText}
                </span>
              </div>

              <div className="campus-detail-header-text">
                <h3 className="campus-detail-name">{activeLocation.name}</h3>
                {activeLocation.subName && (
                  <span className="campus-detail-subname">
                    {activeLocation.subName}
                  </span>
                )}
              </div>

              {/* Hours Card */}
              <div className="campus-detail-hours-block">
                <div className="campus-detail-hours-row">
                  <span className="campus-detail-hours-label">
                    <Clock size={13} strokeWidth={2.2} />
                    {lang === "no" ? "Åpningstider" : "Hours"}
                  </span>
                  <span className="campus-detail-hours-val">{activeLocation.hours}</span>
                </div>
                {activeLocation.lunchHours && (
                  <div className="campus-detail-hours-row secondary">
                    <span>{lang === "no" ? "Varm lunsjmeny" : "Hot lunch"}</span>
                    <span>{activeLocation.lunchHours}</span>
                  </div>
                )}
              </div>

              {/* Description */}
              <p className="campus-detail-desc">
                {activeLocation.description[lang]}
              </p>

              {/* Special Note Banner if any */}
              {activeLocation.specialNote && (
                <div className="campus-detail-note">
                  <Sparkles size={16} className="campus-detail-note-icon" />
                  <span>{activeLocation.specialNote[lang]}</span>
                </div>
              )}

              {/* Today's Dish Preview */}
              {todayDish && (
                <div className="campus-detail-dish-box">
                  <span className="campus-detail-dish-label">
                    <Utensils size={12} />
                    {lang === "no" ? "Dagens lunsjrett" : "Today's main dish"}
                  </span>
                  <p className="campus-detail-dish-title">{todayDish}</p>
                </div>
              )}

              {/* Quick Action button: Scroll to canteen or close */}
              {activeLocation.hasMenu && onSelectCanteen && (
                <button
                  type="button"
                  className="campus-detail-action-btn"
                  onClick={() => {
                    onSelectCanteen(activeLocation.canonicalKey);
                    onClose();
                  }}
                >
                  <span>{lang === "no" ? "Gå til lunsjkort" : "View lunch card"}</span>
                  <ChevronRight size={16} strokeWidth={2.2} />
                </button>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
