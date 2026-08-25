import assert from "node:assert/strict";
import test from "node:test";
import { isLocked, nextTorontoDay, torontoClock } from "../src/time.js";

test("locks exactly at 09:00 Toronto", () => {
  assert.equal(isLocked(new Date("2026-08-25T12:59:59.999Z")), false);
  assert.equal(isLocked(new Date("2026-08-25T13:00:00.000Z")), true);
});

test("maps UTC instants to the Toronto calendar day", () => {
  assert.equal(torontoClock(new Date("2026-08-25T03:59:59Z")).day, "2026-08-24");
  assert.equal(torontoClock(new Date("2026-08-25T04:00:00Z")).day, "2026-08-25");
});

test("advances calendar dates without adding a fixed 24 hours", () => {
  assert.equal(nextTorontoDay("2026-03-08"), "2026-03-09");
  assert.equal(nextTorontoDay("2026-11-01"), "2026-11-02");
});
