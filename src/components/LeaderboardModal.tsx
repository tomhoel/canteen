"use client";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { CANTEEN_ORDER, getCanteenMetadata } from "@/lib/constants";
import { getAttendanceHistory } from "@/lib/api-client";
import "@/styles/leaderboard-modal.css";

interface CanteenStats {
  name: string;
  wins: number;
}

interface LeaderboardModalProps {
  isOpen: boolean;
  lang: "no" | "en";
  onClose: () => void;
}

export default function LeaderboardModal({ isOpen, lang, onClose }: LeaderboardModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const { data, isLoading } = useQuery({
    queryKey: ["attendance-history"],
    queryFn: ({ signal }) => getAttendanceHistory(signal),
    enabled: isOpen,
    staleTime: 60_000,
  });

  const entries = data?.entries || [];

  if (!isOpen) return null;

  // Compute win counts — ties give +1 to all tied canteens
  const stats: CanteenStats[] = CANTEEN_ORDER.map(name => {
    const wins = entries.reduce((acc, entry) => {
      const max = Math.max(0, ...Object.values(entry.canteens));
      return acc + (max > 0 && (entry.canteens[name] || 0) === max ? 1 : 0);
    }, 0);
    return { name, wins };
  }).sort((a, b) => b.wins - a.wins);

  const maxWins = Math.max(1, ...stats.map(s => s.wins));

  // Per-day dot data: which canteens won each day
  const dotData = entries.map(entry => {
    const max = Math.max(0, ...Object.values(entry.canteens));
    const winners = max > 0 ? CANTEEN_ORDER.filter(n => (entry.canteens[n] || 0) === max) : [];
    return { date: entry.date, winners };
  });

  return (
    <motion.div
      className="leaderboard-overlay"
      role="presentation"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onClick={onClose}
    >
      <motion.div
        className="leaderboard-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="leaderboard-title-id"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        transition={{ type: "spring", damping: 28, stiffness: 340 }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="info-close" onClick={onClose} aria-label="Close">&times;</button>

        <h2 id="leaderboard-title-id" className="leaderboard-title">
          {lang === "no" ? "Kantineseiere — siste 2 uker" : "Canteen wins — last 2 weeks"}
        </h2>

        {isLoading ? (
          <div className="leaderboard-skeleton">
            {[0, 1, 2].map(i => (
              <div key={i} className="leaderboard-skeleton-row">
                <div className="skeleton-line" style={{ width: 100, height: 16, borderRadius: 6 }} />
                <div className="skeleton-line" style={{ flex: 1, height: 28, borderRadius: 8, marginLeft: 12 }} />
              </div>
            ))}
          </div>
        ) : entries.length === 0 ? (
          <p className="leaderboard-empty">
            {lang === "no" ? "Ingen stemmer de siste 14 dagene" : "No votes in the last 14 days"}
          </p>
        ) : (
          <>
            <div className="leaderboard-bars">
              {stats.map(s => {
                const meta = getCanteenMetadata(s.name);
                return (
                  <div key={s.name} className="leaderboard-bar-row">
                    <span className="leaderboard-canteen-name">{meta.name}</span>
                    <div className="leaderboard-bar-track">
                      <div
                        className="leaderboard-bar"
                        style={{ width: `${(s.wins / maxWins) * 100}%` }}
                      />
                    </div>
                    <span className="leaderboard-win-count">
                      {s.wins}&nbsp;{lang === "no" ? (s.wins === 1 ? "seier" : "seiere") : (s.wins === 1 ? "win" : "wins")}
                    </span>
                  </div>
                );
              })}
            </div>

            {dotData.length > 0 && (
              <div className="leaderboard-dots-section">
                {/* Date header row */}
                <div className="leaderboard-dots-row leaderboard-dots-header">
                  <span className="leaderboard-dots-label" />
                  <div className="leaderboard-dots">
                    {dotData.map(({ date }) => {
                      const d = new Date(date + 'T12:00:00');
                      const label = `${d.getDate()}.${d.getMonth() + 1}`;
                      return (
                        <span key={date} className="leaderboard-dot-date" title={date}>
                          {label}
                        </span>
                      );
                    })}
                  </div>
                </div>
                {CANTEEN_ORDER.map(name => {
                  const meta = getCanteenMetadata(name);
                  return (
                    <div key={name} className="leaderboard-dots-row">
                      <span className="leaderboard-dots-label">{meta.shortName}</span>
                      <div className="leaderboard-dots">
                        {dotData.map(({ date, winners }) => (
                          <span
                            key={date}
                            className={`leaderboard-dot ${winners.includes(name) ? "won" : "lost"}`}
                            title={date}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <p className="leaderboard-footer">
              {lang === "no" ? "Basert på daglige stemmer" : "Based on daily votes"}
            </p>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}
