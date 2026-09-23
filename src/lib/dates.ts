/** Date helpers operating on ISO calendar dates ("YYYY-MM-DD"), timezone-free. */

export type IsoDate = string;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s: string): s is IsoDate {
  if (!ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function toUtc(d: IsoDate): Date {
  return new Date(`${d}T00:00:00Z`);
}

function fromUtc(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: IsoDate, days: number): IsoDate {
  const x = toUtc(d);
  x.setUTCDate(x.getUTCDate() + days);
  return fromUtc(x);
}

export function endOfMonth(d: IsoDate): IsoDate {
  const x = toUtc(d);
  return fromUtc(new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)));
}

/** Today's date in Asia/Jakarta (WIB), the reference timezone for LPS. */
export function todayWib(now: Date = new Date()): IsoDate {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(now);
}

const LONG = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const MONTH = new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "UTC" });
const DATETIME = new Intl.DateTimeFormat("id-ID", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Jakarta",
});

export function formatTanggal(d: IsoDate | null | undefined): string {
  return d ? LONG.format(toUtc(d)) : "—";
}

export function formatBulan(d: IsoDate): string {
  return MONTH.format(toUtc(d));
}

export function formatWaktu(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return `${DATETIME.format(typeof d === "string" ? new Date(d) : d)} WIB`;
}

export function daysBetween(from: Date, to: Date = new Date()): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}
