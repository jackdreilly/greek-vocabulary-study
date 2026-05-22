/**
 * Helpers for turning Firestore timestamps into "x minutes ago" style labels
 * and for detecting recently-generated content.
 */

export const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Normalise the many shapes a Firestore timestamp can arrive as
 * (client Timestamp, serialized {seconds,nanoseconds}, Date, epoch number)
 * into milliseconds. Returns null when it can't be resolved (e.g. a
 * serverTimestamp() that hasn't been committed yet).
 */
export function toMillis(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "object") {
    const v = value as {
      toMillis?: () => number;
      seconds?: number;
      nanoseconds?: number;
      _seconds?: number;
      _nanoseconds?: number;
    };
    if (typeof v.toMillis === "function") return v.toMillis();
    if (typeof v.seconds === "number") return v.seconds * 1000 + Math.floor((v.nanoseconds ?? 0) / 1e6);
    if (typeof v._seconds === "number") return v._seconds * 1000 + Math.floor((v._nanoseconds ?? 0) / 1e6);
  }
  return null;
}

/** Format a past instant (ms) as a compact "x ago" label relative to `now`. */
export function relativeTimeFromNow(ms: number, now: number = Date.now()): string {
  const diff = now - ms;
  if (diff < 45_000) return "just now";

  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;

  const hours = Math.round(diff / 3_600_000);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.round(diff / 86_400_000);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;

  const months = Math.round(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;

  const years = Math.round(days / 365);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

/** Convenience: "x ago" label straight from a Firestore-ish timestamp value. */
export function timeAgo(value: unknown, now: number = Date.now()): string | null {
  const ms = toMillis(value);
  return ms == null ? null : relativeTimeFromNow(ms, now);
}

/** True when the timestamp resolves to within the last hour of `now`. */
export function isWithinLastHour(value: unknown, now: number = Date.now()): boolean {
  const ms = toMillis(value);
  return ms != null && now - ms < ONE_HOUR_MS && now - ms >= -ONE_HOUR_MS;
}
