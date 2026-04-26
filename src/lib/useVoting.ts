"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { getLocalDateKey } from "@/lib/dateUtils";
import type { CanteenDayItem } from "@/lib/types";

const POLL_INTERVAL = 60_000;

interface UseVotingReturn {
  votes: Record<string, number>;
  hasVoted: boolean;
  votedCanteen: string;
  isVoting: boolean;
  voteSuccess: boolean;
  shareState: "idle" | "loading" | "sent";
  handleVote: (canteenName: string) => Promise<void>;
  handleShareSlack: (canteenDayData: CanteenDayItem[], lang: "no" | "en") => Promise<void>;
  setVoteSuccess: (v: boolean) => void;
  setShareState: (v: "idle" | "loading" | "sent") => void;
}

export function useVoting(): UseVotingReturn {
  const [votes, setVotes] = useState<Record<string, number>>({});
  const [hasVoted, setHasVoted] = useState(false);
  const [votedCanteen, setVotedCanteen] = useState("");
  const [isVoting, setIsVoting] = useState(false);
  const [voteSuccess, setVoteSuccess] = useState(false);
  const [shareState, setShareState] = useState<"idle" | "loading" | "sent">("idle");

  const isVotingRef = useRef(false);
  const shareInFlightRef = useRef(false);

  // Check persisted share state on mount
  useEffect(() => {
    const todayKey = getLocalDateKey();
    const voted = localStorage.getItem(`voted_${todayKey}`);
    if (voted) {
      setHasVoted(true);
      setVotedCanteen(voted);
    }
  }, []);

  // Fetch votes + poll with visibility awareness and vote-in-flight guard
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;

    const fetchVotes = () => {
      if (isVotingRef.current) return; // Skip polling while voting
      fetch("/api/attendance")
        .then(r => r.json())
        .then(data => setVotes(data.canteens || {}))
        .catch(() => {});
    };

    fetchVotes(); // Initial fetch

    const startPolling = () => {
      if (interval) clearInterval(interval);
      interval = setInterval(fetchVotes, POLL_INTERVAL);
    };

    const stopPolling = () => {
      if (interval) { clearInterval(interval); interval = null; }
    };

    const handleVisibility = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        fetchVotes();
        startPolling();
      }
    };

    startPolling();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  const handleVote = useCallback(async (canteenName: string) => {
    setIsVoting(true);
    isVotingRef.current = true;
    try {
      const res = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canteenName, action: "add" }),
      });
      const data = await res.json();
      setVotes(data.canteens || {});
      const todayKey = getLocalDateKey();
      localStorage.setItem(`voted_${todayKey}`, canteenName);
      setVotedCanteen(canteenName);
      setHasVoted(true);
      setVoteSuccess(true);
    } finally {
      setIsVoting(false);
      isVotingRef.current = false;
    }
  }, []);

  const handleShareSlack = useCallback(async (canteenDayData: CanteenDayItem[], lang: "no" | "en") => {
    if (shareInFlightRef.current) return;
    const todayKey = getLocalDateKey();
    if (localStorage.getItem(`slack_shared_${todayKey}`)) return;

    shareInFlightRef.current = true;
    setShareState("loading");
    const dishes = Object.fromEntries(
      canteenDayData.map(c => [c.canteenName, c.mainDish?.dish ?? ""])
    );

    try {
      const res = await fetch("/api/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canteens: votes, dishes, date: todayKey, lang }),
      });
      if (!res.ok) throw new Error(`notify failed: ${res.status}`);
      localStorage.setItem(`slack_shared_${todayKey}`, "1");
      setShareState("sent");
      setTimeout(() => setShareState("idle"), 2000);
    } catch {
      setShareState("idle");
    } finally {
      shareInFlightRef.current = false;
    }
  }, [votes]);

  return {
    votes, hasVoted, votedCanteen, isVoting, voteSuccess, shareState,
    handleVote, handleShareSlack, setVoteSuccess, setShareState,
  };
}
