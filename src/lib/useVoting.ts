import { useState, useEffect, useRef, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { getLocalDateKey } from "@/lib/dateUtils";
import type { CanteenDayItem } from "@/lib/types";
import { submitVote } from "@/server/attendance";
import { sendSlackNotification } from "@/server/notify";

interface UseVotingReturn {
  votes: Record<string, number>;
  hasVoted: boolean;
  votedCanteen: string;
  isVoting: boolean;
  voteSuccess: boolean;
  shareState: "idle" | "loading" | "sent";
  handleVote: (canteenName: string) => Promise<void>;
  handleShareSlack: (
    canteenDayData: CanteenDayItem[],
    lang: "no" | "en"
  ) => Promise<void>;
  setVoteSuccess: (v: boolean) => void;
  setShareState: (v: "idle" | "loading" | "sent") => void;
}

export function useVoting(): UseVotingReturn {
  const [votes, setVotes] = useState<Record<string, number>>({});
  const [hasVoted, setHasVoted] = useState(false);
  const [votedCanteen, setVotedCanteen] = useState("");
  const [voteSuccess, setVoteSuccess] = useState(false);
  const [shareState, setShareState] = useState<"idle" | "loading" | "sent">(
    "idle"
  );

  const shareInFlightRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const todayKey = getLocalDateKey();
    const voted = localStorage.getItem(`voted_${todayKey}`);
    if (voted) {
      setHasVoted(true);
      setVotedCanteen(voted);
    }
  }, []);

  const voteMutation = useMutation({
    mutationFn: async (canteenName: string) => {
      const result = await submitVote({ canteenId: canteenName });
      return { canteenName, canteens: result.canteens };
    },
    onMutate: async (canteenName) => {
      setVotes((prev) => ({
        ...prev,
        [canteenName]: (prev[canteenName] || 0) + 1,
      }));
      setVotedCanteen(canteenName);
      setHasVoted(true);
      setVoteSuccess(true);
      const todayKey = getLocalDateKey();
      if (typeof window !== "undefined") {
        localStorage.setItem(`voted_${todayKey}`, canteenName);
      }
    },
    onSuccess: (data) => {
      if (data.canteens) {
        setVotes(data.canteens);
      }
    },
    onError: (err) => {
      console.error("Optimistic vote error:", err);
    },
  });

  const handleVote = useCallback(
    async (canteenName: string) => {
      await voteMutation.mutateAsync(canteenName);
    },
    [voteMutation]
  );

  const handleShareSlack = useCallback(
    async (canteenDayData: CanteenDayItem[], lang: "no" | "en") => {
      if (shareInFlightRef.current) return;
      const todayKey = getLocalDateKey();
      if (
        typeof window !== "undefined" &&
        localStorage.getItem(`slack_shared_${todayKey}`)
      )
        return;

      shareInFlightRef.current = true;
      setShareState("loading");
      const dishes = Object.fromEntries(
        canteenDayData.map((c) => [c.canteenName, c.mainDish?.dish ?? ""])
      );

      try {
        await sendSlackNotification({ canteens: votes, dishes, date: todayKey, lang });
        if (typeof window !== "undefined") {
          localStorage.setItem(`slack_shared_${todayKey}`, "1");
        }
        setShareState("sent");
        setTimeout(() => setShareState("idle"), 2000);
      } catch {
        setShareState("idle");
      } finally {
        shareInFlightRef.current = false;
      }
    },
    [votes]
  );

  return {
    votes,
    hasVoted,
    votedCanteen,
    isVoting: voteMutation.isPending,
    voteSuccess,
    shareState,
    handleVote,
    handleShareSlack,
    setVoteSuccess,
    setShareState,
  };
}
