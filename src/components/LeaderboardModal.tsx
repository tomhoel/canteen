"use client";
import { useState, useEffect } from "react";
import { CANTEEN_ORDER } from "@/lib/constants";

interface HistoryEntry {
  date: string;
  canteens: Record<string, number>;
}

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
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setIsLoading(true);
    setEntries([]);
    fetch('/api/attendance/history')
      .then(r => r.json())
      .then(data => { setEntries(data.entries || []); setIsLoading(false); })
      .catch(() => setIsLoading(false));
  }, [isOpen]);

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
    <div className="leaderboard-overlay" onClick={onClose}>
      <div className="leaderboard-modal" onClick={e => e.stopPropagation()}>
        <button className="info-close" onClick={onClose} aria-label="Close">&times;</button>

        <h2 className="leaderboard-title">
          {lang === "no" ? "Kantineseiere — siste 2 uker" : "Canteen wins — last 2 weeks"}
        </h2>

        {isLoading ? (
          <div className="leaderboard-skeleton">
            {[0, 1, 2].map(i => (
              <div key={i} className="leaderboard-skeleton-row">
                <div className="skeleton-block" style={{ width: 100, height: 16, borderRadius: 6 }} />
                <div className="skeleton-block" style={{ flex: 1, height: 28, borderRadius: 8, marginLeft: 12 }} />
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
              {stats.map(s => (
                <div key={s.name} className="leaderboard-bar-row">
                  <span className="leaderboard-canteen-name">{s.name}</span>
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
              ))}
            </div>

            {dotData.length > 0 && (
              <div className="leaderboard-dots-section">
                {CANTEEN_ORDER.map(name => (
                  <div key={name} className="leaderboard-dots-row">
                    <span className="leaderboard-dots-label">{name.split(" ")[0]}</span>
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
                ))}
              </div>
            )}

            <p className="leaderboard-footer">
              {lang === "no" ? "Basert på daglige stemmer" : "Based on daily votes"}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
