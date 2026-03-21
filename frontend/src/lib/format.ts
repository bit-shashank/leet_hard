export function formatCountdown(endAt: string | null, serverTime: string) {
  if (!endAt) return "00:00:00";
  const remainingMs = Math.max(
    0,
    new Date(endAt).getTime() - new Date(serverTime).getTime(),
  );

  const totalSeconds = Math.floor(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600)
    .toString()
    .padStart(2, "0");
  const minutes = Math.floor((totalSeconds % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const seconds = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, "0");

  return `${hours}:${minutes}:${seconds}`;
}

export function prettyDateTime(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}
