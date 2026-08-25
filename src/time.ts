export const TORONTO_TIME_ZONE = "America/Toronto";
export const LOCK_SECONDS = 9 * 60 * 60;

export type TorontoClock = {
  day: string;
  hour: number;
  minute: number;
  second: number;
  secondsSinceMidnight: number;
};

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TORONTO_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23"
});

export function torontoClock(date = new Date()): TorontoClock {
  const parts = Object.fromEntries(
    formatter.formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
  );
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const second = Number(parts.second);
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    hour,
    minute,
    second,
    secondsSinceMidnight: hour * 3600 + minute * 60 + second
  };
}

export function isLocked(date = new Date()): boolean {
  return torontoClock(date).secondsSinceMidnight >= LOCK_SECONDS;
}

export function nextTorontoDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, date + 1, 12));
  return torontoClock(next).day;
}
