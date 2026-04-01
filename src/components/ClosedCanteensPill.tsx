"use client";

import { useState } from "react";
import type { CanteenDayItem } from "@/lib/types";

interface ClosedCanteensPillProps {
  closedCanteens: CanteenDayItem[];
  lang: "no" | "en";
}

export default function ClosedCanteensPill({ closedCanteens, lang }: ClosedCanteensPillProps) {
  const [open, setOpen] = useState(false);
  const n = closedCanteens.length;
  if (n === 0) return null;

  const label = lang === "no"
    ? `${n} kantine${n > 1 ? "r" : ""} stengt`
    : `${n} canteen${n > 1 ? "s" : ""} closed`;

  return (
    <div className="closed-pill-wrapper">
      <button className="closed-pill" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <span>{label}</span>
        <svg className={`closed-pill-chevron${open ? " open" : ""}`} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      <div className={`closed-pill-dropdown${open ? " open" : ""}`}>
        {closedCanteens.map(c => (
          <div key={c.canteenName} className="closed-pill-row">
            <span className="closed-pill-name">{c.canteenName}</span>
            <span className="closed-pill-hours">
              {lang === "no" ? "Vanligvis" : "Usually"} {c.canteen.openingHours}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
