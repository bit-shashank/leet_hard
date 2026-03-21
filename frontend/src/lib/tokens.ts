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

export function listSavedRoomCodes(): string[] {
  if (typeof window === "undefined") return [];

  const codes = new Set<string>();
  const keyPrefix = `${PREFIX}:`;

  for (let i = 0; i < window.localStorage.length; i += 1) {
    const storageKey = window.localStorage.key(i);
    if (!storageKey || !storageKey.startsWith(keyPrefix)) continue;

    const code = storageKey.slice(keyPrefix.length).trim().toUpperCase();
    if (code) {
      codes.add(code);
    }
  }

  return Array.from(codes).sort();
}
