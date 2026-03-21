const PREFIX = "leetcode-room-token";

function key(roomCode: string) {
  return `${PREFIX}:${roomCode.toUpperCase()}`;
}

export function saveRoomToken(roomCode: string, token: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key(roomCode), token);
}

export function getRoomToken(roomCode: string): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(key(roomCode));
}

export function clearRoomToken(roomCode: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(key(roomCode));
}
