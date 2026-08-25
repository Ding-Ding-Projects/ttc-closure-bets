import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Store } from "../src/database.js";
import { applyImmediateSettlements, coverageComplete } from "../src/settlement.js";
import type { LineStatus } from "../src/ttc.js";

function withStore(run: (store: Store) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "ttc-bets-"));
  const store = new Store(join(directory, "test.sqlite"));
  try { run(store); } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
}

const normalStatuses = (): LineStatus[] => ["1", "2", "4", "5", "6"].map((line) => ({ line, title: "Normal service", description: null, normal: true })) as LineStatus[];

test("a disruption wins positive lines and loses line 6 immediately", () => withStore((store) => {
  const now = Date.parse("2026-08-25T12:00:00Z");
  store.upsertPlayer("a", "A", now);
  store.upsertPlayer("b", "B", now);
  store.putBet("a", "2026-08-25", "2", now);
  store.putBet("b", "2026-08-25", "6", now);
  const statuses = normalStatuses();
  statuses.find((item) => item.line === "2")!.normal = false;
  statuses.find((item) => item.line === "6")!.normal = false;
  applyImmediateSettlements(store, "2026-08-25", statuses, now);
  assert.equal(store.bet("a", "2026-08-25")?.result, "won");
  assert.equal(store.bet("b", "2026-08-25")?.result, "lost");
}));

test("complete day settles no-disruption outcomes", () => withStore((store) => {
  const day = "2026-08-25";
  const first = Date.parse("2026-08-25T04:01:00Z");
  const last = Date.parse("2026-08-26T03:58:00Z");
  for (let time = first; time < last; time += 5 * 60 * 1000) store.recordPoll(day, time, normalStatuses());
  store.recordPoll(day, last, normalStatuses());
  assert.equal(coverageComplete(store, day), true);
  store.upsertPlayer("a", "A", first);
  store.upsertPlayer("b", "B", first);
  store.putBet("a", day, "1", first);
  store.putBet("b", day, "6", first);
  store.settleEndOfDay(day, true, last + 120_000);
  assert.equal(store.bet("a", day)?.result, "lost");
  assert.equal(store.bet("b", day)?.result, "won");
}));

test("a gap greater than five minutes makes absence-dependent results unresolved", () => withStore((store) => {
  const day = "2026-08-25";
  store.recordPoll(day, Date.parse("2026-08-25T04:01:00Z"), normalStatuses());
  store.recordPoll(day, Date.parse("2026-08-25T04:06:00.001Z"), normalStatuses());
  store.recordPoll(day, Date.parse("2026-08-26T03:58:00Z"), normalStatuses());
  assert.equal(coverageComplete(store, day), false);
  store.upsertPlayer("a", "A", Date.now());
  store.putBet("a", day, "6", Date.now());
  store.settleEndOfDay(day, false, Date.now());
  assert.equal(store.bet("a", day)?.result, "unresolved");
}));

test("one player has one revisable prediction per day", () => withStore((store) => {
  store.upsertPlayer("a", "A", 1);
  store.putBet("a", "2026-08-25", "1", 2);
  store.putBet("a", "2026-08-25", "6", 3);
  assert.equal(store.bet("a", "2026-08-25")?.line, "6");
  const count = store.db.prepare("SELECT COUNT(*) value FROM bets").get() as { value: number };
  assert.equal(count.value, 1);
}));
