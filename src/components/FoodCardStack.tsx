"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import FoodCard from "@/components/FoodCard";
import type { CanteenDayItem } from "@/lib/types";

export interface NextWeekPreview {
  weekNum: number;
  mainDish: string | null;
  sideDishes: string[];
}

interface FoodCardStackProps {
  data: CanteenDayItem;
  cardIdx: number;
  lang: "no" | "en";
  selectedDay: number;
  activeDayIndex: number;
  voteCount: number;
  maxVotes: number;
  onImageClick: (data: CanteenDayItem) => void;
  onCardClick: (canteenName: string) => void;
  nextWeek: NextWeekPreview | null;
}

export default function FoodCardStack(props: FoodCardStackProps) {
  const { data, lang, nextWeek, ...cardProps } = props;
  const [showingNext, setShowingNext] = useState(false);

  if (!nextWeek?.mainDish) {
    return <FoodCard data={data} lang={lang} {...cardProps} />;
  }

  const weekLabel = lang === "no" ? `Uke ${nextWeek.weekNum}` : `Week ${nextWeek.weekNum}`;

  return (
    <div className="food-card-stack">
      {/* Front card */}
      <div className="stack-front">
        <FoodCard data={data} lang={lang} {...cardProps} />
      </div>

      {/* Peek strip — the back card peeking from behind */}
      <AnimatePresence>
        {!showingNext && (
          <motion.button
            className="next-week-peek"
            onClick={() => setShowingNext(true)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            transition={{ delay: 0.15, duration: 0.25 }}
            whileTap={{ scale: 0.98 }}
            aria-label={lang === "no" ? `Vis neste uke — ${nextWeek.mainDish}` : `Show next week — ${nextWeek.mainDish}`}
          >
            <span className="peek-sparkle" aria-hidden="true">✨</span>
            <span className="peek-week">{weekLabel}</span>
            <span className="peek-dish">{nextWeek.mainDish}</span>
            <span className="peek-arrow" aria-hidden="true">›</span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Next week overlay — slides in on top of the front card */}
      <AnimatePresence>
        {showingNext && (
          <motion.div
            className="next-week-overlay"
            initial={{ y: 28, opacity: 0, scale: 0.97 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 20, opacity: 0, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 400, damping: 34 }}
          >
            <article className="food-card next-week-card">
              <button
                className="next-week-back-btn"
                onClick={() => setShowingNext(false)}
              >
                ‹ {lang === "no" ? "Denne uka" : "This week"}
              </button>

              <div className="next-week-hero">
                <span className="next-week-hero-icon" aria-hidden="true">✨</span>
                <p className="next-week-hero-label">
                  {lang === "no" ? `Neste uke · ${weekLabel}` : `Next week · ${weekLabel}`}
                </p>
              </div>

              <div className="card-content">
                <div className="card-header">
                  <div className="canteen-name">{data.canteenName}</div>
                  <h3 className="dish-name">{nextWeek.mainDish}</h3>
                </div>
              </div>

              <div className="card-bottom">
                <div className="side-dishes-title">
                  {lang === "no" ? "Andre retter" : "Other dishes"}
                </div>
                <div className="side-dish-list">
                  {nextWeek.sideDishes.length > 0
                    ? nextWeek.sideDishes.map((dish, i) => (
                        <div key={i} className="side-dish-item">
                          <span className="side-dish-text">{dish}</span>
                        </div>
                      ))
                    : (
                        <div className="side-dish-item" style={{ justifyContent: "center", color: "var(--text-muted)" }}>
                          {lang === "no" ? "Ingen andre retter" : "No other dishes"}
                        </div>
                      )}
                </div>
              </div>
            </article>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
