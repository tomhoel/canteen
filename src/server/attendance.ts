import { submitVoteService } from "./services/attendance.service";

export async function getAttendanceHistory() {
  return { entries: [] };
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
