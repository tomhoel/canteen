"use client";

import type { CanteenDayItem } from "@/lib/types";

interface ClosedCanteensPillProps {
  closedCanteens: CanteenDayItem[];
  lang: "no" | "en";
}

export default function ClosedCanteensPill({ closedCanteens, lang }: ClosedCanteensPillProps) {
  const n = closedCanteens.length;
  if (n === 0) return null;

  const names = closedCanteens.map(c => c.canteenName);
  const joinedNames = names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(", ")} ${lang === "no" ? "og" : "and"} ${names[names.length - 1]}`;

  const label = lang === "no"
    ? `${n} kantine${n > 1 ? "r" : ""} stengt`
    : `${n} canteen${n > 1 ? "s" : ""} closed`;

  // Desktop: pill with hover tooltip showing names
  // Mobile: discrete text below day bar (separate element rendered in page.tsx)
  return (
    <>
      {/* Desktop pill — centered in header */}
      <div className="closed-pill-wrapper closed-pill-desktop">
        <div className="closed-pill" role="status">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{label}</span>
          <div className="closed-pill-tooltip">
            {closedCanteens.map(c => (
              <div key={c.canteenName} className="closed-pill-tooltip-row">
                <span>{c.canteenName}</span>
                <span>{c.canteen.openingHours}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Mobile text — sits below day bar */}
      <div className="closed-canteens-text closed-pill-mobile" role="status">
        <span>
          {joinedNames} {lang === "no" ? "hviler i dag" : n === 1 ? "is closed today" : "are closed today"}
        </span>
      </div>
    </>
  );
}
