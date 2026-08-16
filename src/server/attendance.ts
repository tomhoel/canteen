import {
  getAttendanceHistoryService,
  submitVoteService,
} from "./services/attendance.service.js";

/**
 * The leaderboard's data.
 *
 * This was `return { entries: [] }` — a stub, not a fallback. The modal it
 * feeds renders "no votes in the last 14 days" for an empty list, so a feature
 * that had never worked was indistinguishable from a quiet fortnight, and no
 * log line or error ever suggested otherwise.
 */
export async function getAttendanceHistory() {
  return await getAttendanceHistoryService();
}

export interface VotePayload {
  canteenId: string;
}

export async function submitVote(data: VotePayload) {
  if (!data || !data.canteenId) {
    throw new Error("Invalid canteenId");
  }
  return await submitVoteService(data.canteenId);
}
