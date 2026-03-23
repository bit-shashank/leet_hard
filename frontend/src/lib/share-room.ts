import { formatProblemSource } from "@/lib/problem-source";
import type { ProblemSource, RoomStatus } from "@/lib/types";

type ShareRoomInput = {
  roomCode: string;
  roomTitle: string;
  status: RoomStatus;
  scheduledStartAt: string;
  startsAt: string | null;
  endsAt: string | null;
  durationMinutes?: number | null;
  easyCount: number;
  mediumCount: number;
  hardCount: number;
  problemSource: ProblemSource;
  strictCheck?: boolean | null;
  hasPasscode: boolean;
};

function formatDate(value: string | null) {
  if (!value) return "TBD";
  return new Date(value).toLocaleString();
}

function normalizeRoomCode(roomCode: string) {
  return roomCode.trim().toUpperCase();
}

function resolveJoinUrl(roomCode: string) {
  if (typeof window === "undefined") {
    return `/join/${roomCode}`;
  }
  const origin = window.location.origin.replace(/\/$/, "");
  return `${origin}/join/${roomCode}`;
}

function getStatusLine(input: ShareRoomInput) {
  if (input.status === "active") {
    return `Status: Live now (ends ${formatDate(input.endsAt)})`;
  }
  if (input.status === "ended") {
    return `Status: Ended (started ${formatDate(input.startsAt)})`;
  }
  return `Status: Lobby (starts ${formatDate(input.scheduledStartAt)})`;
}

export function buildRoomShareMessage(input: ShareRoomInput) {
  const roomCode = normalizeRoomCode(input.roomCode);
  const joinUrl = resolveJoinUrl(roomCode);
  const lines = [
    `Join my LeetRace room: ${input.roomTitle}`,
    `Room Code: ${roomCode}`,
    getStatusLine(input),
    `Difficulty Mix: Easy ${input.easyCount} | Medium ${input.mediumCount} | Hard ${input.hardCount}`,
    `Source: ${formatProblemSource(input.problemSource)}`,
    `Passcode: ${input.hasPasscode ? "Required" : "Not required"}`,
    `Join Link: ${joinUrl}`,
  ];

  if (typeof input.durationMinutes === "number") {
    lines.splice(3, 0, `Duration: ${input.durationMinutes} minutes`);
  }
  if (typeof input.strictCheck === "boolean") {
    lines.splice(lines.length - 2, 0, `Strict Checking: ${input.strictCheck ? "Enabled" : "Disabled"}`);
  }

  return {
    joinUrl,
    message: lines.join("\n"),
  };
}

async function fallbackCopyText(text: string) {
  if (typeof document === "undefined") {
    throw new Error("Clipboard is not available in this environment.");
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!copied) {
    throw new Error("Unable to copy invite message.");
  }
}

export async function copyRoomShareMessage(input: ShareRoomInput) {
  const payload = buildRoomShareMessage(input);
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(payload.message);
    return payload;
  }

  await fallbackCopyText(payload.message);
  return payload;
}
