import assert from "node:assert/strict";
import test from "node:test";
import { parseTtcStatuses, TRACKED_LINES } from "../src/ttc.js";

function card(line: string, title: string, description = ""): string {
  return `<div class="subway-line-group"><div><a href="/routes-and-schedules/${line}/0"><span>${line}</span></a></div><div class="alerts-content"><div class="alert-title">${title}</div><div class="alert-description">${description}</div></div></div>`;
}

test("parses exactly the five tracked lines structurally", () => {
  const html = TRACKED_LINES.map((line) => card(line, line === "2" ? "No service" : "Normal service", `Line ${line}`)).join("");
  const statuses = parseTtcStatuses(html);
  assert.deepEqual(statuses.map((item) => item.line), [...TRACKED_LINES]);
  assert.equal(statuses.find((item) => item.line === "2")?.normal, false);
  assert.equal(statuses.find((item) => item.line === "1")?.normal, true);
});

test("normalizes nested text and entities", () => {
  const html = TRACKED_LINES.map((line) => card(line, line === "5" ? " <span>Normal</span> &nbsp; service " : "Normal service")).join("");
  const statuses = parseTtcStatuses(html);
  assert.equal(statuses.find((item) => item.line === "5")?.title, "Normal service");
});

test("invalidates a duplicated tracked line", () => {
  const html = TRACKED_LINES.map((line) => card(line, "Normal service")).join("") + card("6", "No service");
  const statuses = parseTtcStatuses(html);
  assert.equal(statuses.some((item) => item.line === "6"), false);
  assert.equal(statuses.length, 4);
});

test("does not pair a route with a neighboring card", () => {
  const html = `<div class="subway-line-group"><a href="/routes-and-schedules/1/0">1</a></div>${card("2", "No service")}`;
  const statuses = parseTtcStatuses(html);
  assert.deepEqual(statuses.map((item) => item.line), ["2"]);
});
