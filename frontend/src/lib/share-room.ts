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
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "TBD";
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
  const dayMonth = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
  }).format(parsed);
  return `${time}, ${dayMonth}`;
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
    return `Live now • Ends ${formatDate(input.endsAt)}`;
  }
  if (input.status === "ended") {
    return `Completed • Started ${formatDate(input.startsAt)}`;
  }
  return `Starts ${formatDate(input.scheduledStartAt)}`;
}

function problemLine(input: ShareRoomInput) {
  const entries = [
    { count: input.easyCount, label: "easy" },
    { count: input.mediumCount, label: "medium" },
    { count: input.hardCount, label: "hard" },
  ].filter((entry) => entry.count > 0);

  if (!entries.length) return "No problems configured";
  if (entries.length === 1) {
    const only = entries[0];
    return `${only.count} ${only.label} problem${only.count === 1 ? "" : "s"}`;
  }
  return `Problems: ${entries.map((entry) => `${entry.count} ${entry.label}`).join(" • ")}`;
}

export function buildRoomShareMessage(input: ShareRoomInput) {
  const roomCode = normalizeRoomCode(input.roomCode);
  const joinUrl = resolveJoinUrl(roomCode);
  const details: string[] = [getStatusLine(input), problemLine(input)];
  if (typeof input.durationMinutes === "number") {
    details.push(`${input.durationMinutes} min sprint`);
  }
  if (input.hasPasscode) {
    details.push("Passcode required");
  }

  const lines = [
    `You're invited to my LeetRace room: ${input.roomTitle}`,
    "",
    ...details,
    "",
    `Use code ${roomCode} to join.`,
    `Join: ${joinUrl}`,
  ];

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
