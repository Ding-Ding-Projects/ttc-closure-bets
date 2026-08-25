export const TRACKED_LINES = ["1", "2", "4", "5", "6"] as const;
export type TrackedLine = (typeof TRACKED_LINES)[number];

export type LineStatus = {
  line: TrackedLine;
  title: string;
  description: string | null;
  normal: boolean;
};

export function parseTtcStatuses(html: string): LineStatus[] {
  const $ = load(html);
  const found = new Map<TrackedLine, LineStatus>();
  const duplicated = new Set<TrackedLine>();
  $(".subway-line-group").each((_index, group) => {
    const card = $(group);
    const anchor = card.find('a[href^="/routes-and-schedules/"]').first();
    const match = (anchor.attr("href") || "").match(/^\/routes-and-schedules\/(\d+)\/0$/);
    if (!match) return;
    const line = match[1] as TrackedLine;
    if (!TRACKED_LINES.includes(line)) return;
    if (found.has(line)) { duplicated.add(line); return; }
    const title = card.find(".alert-title").first().text().replace(/\s+/g, " ").trim();
    const description = card.find(".alert-description").first().text().replace(/\s+/g, " ").trim();
    if (!title) return;
    found.set(line, { line, title, description: description || null, normal: /^normal service$/i.test(title) });
  });
  for (const line of duplicated) found.delete(line);
  return [...found.values()].sort((a, b) => Number(a.line) - Number(b.line));
}

export async function fetchTtcStatuses(url: string, signal: AbortSignal): Promise<LineStatus[]> {
  const response = await fetch(url, {
    redirect: "error",
    signal,
    headers: { "User-Agent": "ttc-closure-bets/1.0 (+https://toronto-transit.org)" }
  });
  if (!response.ok) throw new Error(`TTC request returned HTTP ${response.status}`);
  const type = response.headers.get("content-type") || "";
  if (!type.toLowerCase().includes("text/html")) throw new Error("TTC response was not HTML");
  const declaredLength = Number(response.headers.get("content-length") || "0");
  if (declaredLength > 2_000_000) throw new Error("TTC response exceeded the 2 MB limit");
  const html = await response.text();
  if (Buffer.byteLength(html) > 2_000_000) throw new Error("TTC response exceeded the 2 MB limit");
  const statuses = parseTtcStatuses(html);
  if (statuses.length !== TRACKED_LINES.length) {
    throw new Error(`TTC response returned ${statuses.length} of ${TRACKED_LINES.length} tracked lines`);
  }
  return statuses;
}
import { load } from "cheerio";
