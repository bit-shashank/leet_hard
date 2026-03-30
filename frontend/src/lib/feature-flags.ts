const DISABLED_FLAG_VALUES = new Set(["false", "0", "off", "no"]);

function parseFeatureFlag(value: string | undefined): boolean {
  if (value === undefined) {
    return true;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return !DISABLED_FLAG_VALUES.has(normalized);
}

export const isRoomStartCountdownEnabled = parseFeatureFlag(
  process.env.NEXT_PUBLIC_ROOM_START_COUNTDOWN_ENABLED,
);
