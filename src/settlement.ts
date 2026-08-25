import type { Store } from "./database.js";
import { TRACKED_LINES, type LineStatus } from "./ttc.js";
import { nextTorontoDay, torontoClock } from "./time.js";

export function coverageComplete(store: Store, day: string): boolean {
  const times = store.successfulPollTimes(day);
  if (!times.length) return false;
  const first = torontoClock(new Date(times[0]));
  const last = torontoClock(new Date(times[times.length - 1]));
  if (first.day !== day || first.secondsSinceMidnight > 120) return false;
  if (last.day !== day || last.secondsSinceMidnight < 23 * 3600 + 58 * 60) return false;
  for (let i = 1; i < times.length; i += 1) {
    if (times[i] - times[i - 1] > 5 * 60 * 1000) return false;
  }
  return true;
}

export function applyImmediateSettlements(store: Store, day: string, statuses: LineStatus[], now: number): void {
  for (const status of statuses) if (!status.normal) store.settleImmediate(day, status.line, now);
}

export function settlePreviousDays(store: Store, currentDay: string, now: number): void {
  const rows = store.db.prepare("SELECT DISTINCT day FROM bets WHERE day<? AND result='pending'").all(currentDay) as { day: string }[];
  for (const { day } of rows) store.settleEndOfDay(day, coverageComplete(store, day), now);
}

export function dayEligible(store: Store, day: string): boolean {
  const first = store.firstSuccessfulPoll(day);
  if (first === null) return false;
  const clock = torontoClock(new Date(first));
  return clock.day === day && clock.secondsSinceMidnight <= 120;
}

export function dayEligibleNow(store: Store, day: string, now = Date.now()): boolean {
  if (!dayEligible(store, day)) return false;
  const times = store.successfulPollTimes(day);
  if (!times.length) return false;
  for (let i = 1; i < times.length; i += 1) if (times[i] - times[i - 1] > 5 * 60 * 1000) return false;
  return now - times[times.length - 1] <= 5 * 60 * 1000;
}

export function displayDay(store: Store, now = new Date()): string {
  const today = torontoClock(now).day;
  return dayEligibleNow(store, today, now.getTime()) ? today : nextTorontoDay(today);
}

export const lineMetadata = TRACKED_LINES.map((line) => ({ line, prediction: line === "6" ? "normal" : "disrupted" }));
