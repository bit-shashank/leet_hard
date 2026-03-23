const PENDING_JOIN_ROOM_CODE_KEY = "leetrace:pending_join_room_code";

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
