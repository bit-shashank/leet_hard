const PENDING_JOIN_ROOM_CODE_KEY = "leetrace:pending_join_room_code";
const PENDING_JOIN_ERROR_KEY = "leetrace:pending_join_error";
const FLASH_NOTICE_KEY = "leetrace:flash_notice";

export function savePendingJoinRoomCode(roomCode: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PENDING_JOIN_ROOM_CODE_KEY, roomCode.trim().toUpperCase());
}

export function takePendingJoinRoomCode(): string | null {
  if (typeof window === "undefined") return null;
  const value = window.localStorage.getItem(PENDING_JOIN_ROOM_CODE_KEY);
  if (!value) return null;
  window.localStorage.removeItem(PENDING_JOIN_ROOM_CODE_KEY);
  return value.trim().toUpperCase() || null;
}

export function savePendingJoinError(message: string) {
  if (typeof window === "undefined") return;
  const normalized = message.trim();
  if (!normalized) return;
  window.localStorage.setItem(PENDING_JOIN_ERROR_KEY, normalized);
}

export function takePendingJoinError(): string | null {
  if (typeof window === "undefined") return null;
  const value = window.localStorage.getItem(PENDING_JOIN_ERROR_KEY);
  if (!value) return null;
  window.localStorage.removeItem(PENDING_JOIN_ERROR_KEY);
  return value.trim() || null;
}

export function saveFlashNotice(message: string) {
  if (typeof window === "undefined") return;
  const normalized = message.trim();
  if (!normalized) return;
  window.localStorage.setItem(FLASH_NOTICE_KEY, normalized);
}

export function takeFlashNotice(): string | null {
  if (typeof window === "undefined") return null;
  const value = window.localStorage.getItem(FLASH_NOTICE_KEY);
  if (!value) return null;
  window.localStorage.removeItem(FLASH_NOTICE_KEY);
  return value.trim() || null;
}
