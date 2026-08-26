import { useState, useEffect, useRef, useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import confetti from "canvas-confetti";
import { toast } from "sonner";
import { getLocalDateKey } from "@/lib/dateUtils";
import type { CanteenDayItem } from "@/lib/types";
import { submitVote, sendSlackNotification, getAttendanceHistory } from "@/lib/api-client";

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

  /**
   * Today's tally, so the cards show where people are already going rather than
   * three zeroes until you vote yourself. `votes` started empty on every load
   * and was only ever filled by your own tap.
   */
  const historyQuery = useQuery({
    queryKey: ["attendance-history"],
    queryFn: () => getAttendanceHistory(),
    staleTime: 60_000,
  });

  const seeded = useRef(false);

  useEffect(() => {
    if (seeded.current || !historyQuery.data) return;
    seeded.current = true;
    const today = historyQuery.data.entries.find((e) => e.date === getLocalDateKey());
    // Never over a tally we already hold: if a vote landed while this was in
    // flight, its numbers are the fresher ones.
    if (today) setVotes((prev) => (Object.keys(prev).length > 0 ? prev : today.canteens));
  }, [historyQuery.data]);

  const voteMutation = useMutation({
    mutationFn: async (canteenName: string) => {
      const result = await submitVote({ canteenId: canteenName });
      return { canteenName, canteens: result.canteens };
    },
    onMutate: async (canteenName) => {
      // Kept so it can be put back if the write turns out to have failed.
      const previous = { votes, hasVoted, votedCanteen };

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

      confetti({
        particleCount: 50,
        spread: 60,
        origin: { y: 0.75 },
        colors: ["#c8741a", "#e8a020", "#4a9e55", "#fffaf0"],
        disableForReducedMotion: true,
      });
      toast.success(`Du stemte på ${canteenName}! 🗳️`, { duration: 3000 });

      return previous;
    },
    onSuccess: (data) => {
      // An empty tally must never overwrite the optimistic count. That is
      // precisely how the vote used to disappear: the server could not store it,
      // answered `{ canteens: {} }` with a 200, and `{}` is truthy — so the
      // number you had just watched appear was replaced with nothing.
      if (data.canteens && Object.keys(data.canteens).length > 0) {
        setVotes(data.canteens);
      }
    },
    onError: (err, _canteenName, previous) => {
      // Roll the optimistic vote back. Leaving it up marks you as having voted
      // — in localStorage, so across reloads — and disables the button for the
      // rest of the day, all for a vote that was never recorded anywhere.
      console.error("Vote could not be recorded:", err);
      if (previous) {
        setVotes(previous.votes);
        setHasVoted(previous.hasVoted);
        setVotedCanteen(previous.votedCanteen);
      }
      setVoteSuccess(false);
      if (typeof window !== "undefined") {
        localStorage.removeItem(`voted_${getLocalDateKey()}`);
      }
      toast.error("Kunne ikke registrere stemmen din. Prøv igjen.");
    },
  });

  const handleVote = useCallback(
    async (canteenName: string) => {
      try {
        await voteMutation.mutateAsync(canteenName);
      } catch {
        // onError has already rolled the optimistic update back. Swallowing the
        // rejection here keeps it from reaching the click handler as an
        // unhandled rejection — which is what it would do now that a write the
        // database refuses actually throws instead of answering 200.
      }
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
        toast.success(
          lang === "no"
            ? "Dagens lunsjvalg er delt på Slack! 🚀"
            : "Lunch votes shared to Slack! 🚀"
        );
        setTimeout(() => setShareState("idle"), 2000);
      } catch {
        setShareState("idle");
        toast.error(
          lang === "no"
            ? "Kunne ikke dele til Slack."
            : "Could not share to Slack."
        );
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
