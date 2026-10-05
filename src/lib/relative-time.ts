/**
 * The server's clock for one request. Server Components render once per request, so a
 * timestamp taken while rendering is stable for everything that request draws.
 */
export function requestTime(): number {
  return Date.now();
}

/** "vừa xong", "5 phút trước", "hôm qua" — how long ago, the way a person would say it. */
export function relativeTime(date: Date | number, now: number = Date.now()): string {
  const then = typeof date === "number" ? date : date.getTime();
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return "vừa xong";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.round(hours / 24);
  if (days === 1) return "hôm qua";
  if (days < 7) return `${days} ngày trước`;
  const day = new Date(then);
  return `${day.getDate()}/${day.getMonth() + 1}/${day.getFullYear()}`;
}
