"use client";

import { useEffect, useState } from "react";

interface YoloButtonProps {
  onSpin: (soundEnabled: boolean) => void;
  spinning: boolean;
  disabled?: boolean;
  lang: "no" | "en";
}

const SOUND_KEY = "yolo_sound_enabled";

export default function YoloButton({ onSpin, spinning, disabled, lang }: YoloButtonProps) {
  const [soundEnabled, setSoundEnabled] = useState(false);

  // Restore preference from localStorage on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    setSoundEnabled(window.localStorage.getItem(SOUND_KEY) === "1");
  }, []);

  const toggleSound = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSoundEnabled((prev) => {
      const next = !prev;
      try { window.localStorage.setItem(SOUND_KEY, next ? "1" : "0"); } catch {}
      return next;
    });
  };

  const handleClick = () => {
    if (disabled || spinning) return;
    onSpin(soundEnabled);
  };

  const labelIdle = lang === "no" ? "YOLO" : "YOLO";
  const labelSpinning = lang === "no" ? "Snurrer…" : "Spinning…";
  const soundTitle = lang === "no"
    ? (soundEnabled ? "Skru av lyd" : "Skru på lyd")
    : (soundEnabled ? "Mute" : "Unmute");

  return (
    <div className="yolo-wrap">
      <button
        type="button"
        className={`yolo-button${spinning ? " spinning" : ""}`}
        onClick={handleClick}
        disabled={disabled || spinning}
        aria-label={lang === "no" ? "Velg en kantine tilfeldig" : "Pick a canteen at random"}
        title={lang === "no" ? "Velg en kantine tilfeldig" : "Pick a canteen at random"}
      >
        <span className="yolo-label">{spinning ? labelSpinning : labelIdle}</span>
      </button>
      <button
        type="button"
        className={`yolo-sound${soundEnabled ? " on" : " off"}`}
        onClick={toggleSound}
        aria-label={soundTitle}
        title={soundTitle}
      >
        {soundEnabled ? (
          // speaker on
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M3 5h2.5L9 2v12L5.5 11H3V5z" fill="currentColor" />
            <path d="M11 5.5a3.5 3.5 0 010 5M12.5 4a5.5 5.5 0 010 8" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
          </svg>
        ) : (
          // speaker muted
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M3 5h2.5L9 2v12L5.5 11H3V5z" fill="currentColor" />
            <path d="M11 6l3 4M14 6l-3 4" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
          </svg>
        )}
      </button>
    </div>
  );
}
