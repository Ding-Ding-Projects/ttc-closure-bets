import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import staticPlugin from "@fastify/static";
import { Store } from "./database.js";
import { coverageComplete, dayEligibleNow, displayDay, lineMetadata, lockAndReconcile, settlePreviousDays } from "./settlement.js";
import { fetchTtcStatuses, TRACKED_LINES, type TrackedLine } from "./ttc.js";
import { isLocked, torontoClock } from "./time.js";

const port = Number(process.env.PORT || 3000);
const databasePath = process.env.DATABASE_PATH || ".data/ttc-closure-bets.sqlite";
const ttcUrl = process.env.TTC_STATUS_URL || "https://www.ttc.ca/";
const production = process.env.NODE_ENV === "production";
const publicOrigin = process.env.PUBLIC_ORIGIN || (production ? "https://toronto-transit.org" : "");
if (production && new URL(ttcUrl).origin !== "https://www.ttc.ca") throw new Error("Production TTC_STATUS_URL must use https://www.ttc.ca/");
if (production && new URL(publicOrigin).origin !== publicOrigin) throw new Error("PUBLIC_ORIGIN must be an exact origin without a path");
const pollMs = Math.max(30_000, Number(process.env.POLL_INTERVAL_MS || 60_000));
const fixedTestNow = process.env.NODE_ENV === "test" && process.env.TEST_NOW ? Date.parse(process.env.TEST_NOW) : null;
if (fixedTestNow !== null && !Number.isFinite(fixedTestNow)) throw new Error("TEST_NOW must be an ISO-8601 timestamp");
const nowMs = (): number => fixedTestNow ?? Date.now();
const nowDate = (): Date => new Date(nowMs());
const store = new Store(databasePath);
const app = Fastify({ logger: true, bodyLimit: 16_384, trustProxy: (_address, hop) => hop === 0 });
await app.register(cookie);
await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
await app.register(staticPlugin, { root: join(fileURLToPath(new URL("..", import.meta.url)), "public"), prefix: "/" });

app.addHook("onSend", async (_request, reply) => {
  reply.headers({
    "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()"
  });
  if (_request.url.startsWith("/api/") || _request.url === "/healthz" || _request.url === "/readyz") {
    reply.header("cache-control", "private, no-store");
    reply.header("vary", "Cookie");
  }
});

const cookieName = production ? "__Host-ttc_player" : "ttc_player";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function playerId(request: { cookies: Record<string, string | undefined> }): string | undefined {
  const candidate = request.cookies[cookieName];
  return candidate && uuidPattern.test(candidate) ? candidate : undefined;
}

function requirePlayer(request: { cookies: Record<string, string | undefined> }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }): string | undefined {
  const id = playerId(request);
  if (!id || !store.player(id)) {
    reply.code(401).send({ error: "Choose a nickname first" });
    return undefined;
  }
  return id;
}

function requireSameOrigin(request: { headers: Record<string, string | string[] | undefined>; protocol: string; hostname: string }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }): boolean {
  const origin = request.headers.origin;
  const expected = publicOrigin || `${request.protocol}://${request.hostname}`;
  if (typeof origin !== "string" || origin.includes(",")) {
    reply.code(403).send({ error: "Origin required" });
    return false;
  }
  try {
    if (new URL(origin).origin === expected && (!request.headers["sec-fetch-site"] || request.headers["sec-fetch-site"] === "same-origin")) return true;
  } catch {}
  reply.code(403).send({ error: "Origin refused" });
  return false;
}

app.get("/api/today", async (request) => {
  const now = nowDate();
  const clock = torontoClock(now);
  const day = displayDay(store, now);
  const locked = day === clock.day ? isLocked(now) : false;
  const id = playerId(request);
  if (day === clock.day && isLocked(now)) lockAndReconcile(store, day, now.getTime());
  const bet = id ? store.bet(id, day) : undefined;
  return {
    serverTime: now.toISOString(),
    torontoDay: day,
    torontoTime: `${String(clock.hour).padStart(2, "0")}:${String(clock.minute).padStart(2, "0")}:${String(clock.second).padStart(2, "0")}`,
    eligible: day === clock.day && dayEligibleNow(store, day, now.getTime()),
    locked,
    lockSeconds: 9 * 3600,
    lines: lineMetadata,
    statuses: store.currentStatuses(clock.day),
    profile: id ? store.publicProfile(id) : null,
    bet: bet ?? null,
    latestResult: id ? store.latestResult(id) ?? null : null,
    board: locked ? store.board(day) : [],
    coverageComplete: day < clock.day ? coverageComplete(store, day) : false
  };
});

app.put("/api/profile", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
  if (!requireSameOrigin(request, reply)) return;
  const nickname = typeof (request.body as { nickname?: unknown })?.nickname === "string" ? (request.body as { nickname: string }).nickname.normalize("NFC").trim() : "";
  if (!nickname || [...nickname].length > 32 || Buffer.byteLength(nickname, "utf8") > 128 || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]|\p{Default_Ignorable_Code_Point}/u.test(nickname)) {
    return reply.code(400).send({ error: "Nickname must be 1 to 32 visible characters" });
  }
  const candidate = playerId(request);
  const id = candidate && store.player(candidate) ? candidate : randomUUID();
  store.upsertPlayer(id, nickname, nowMs());
  reply.setCookie(cookieName, id, { path: "/", httpOnly: true, secure: production, sameSite: "strict", maxAge: 60 * 60 * 24 * 365 });
  return { nickname };
});

app.put("/api/bet", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
  if (!requireSameOrigin(request, reply)) return;
  const id = requirePlayer(request, reply);
  if (!id) return;
  const now = nowDate();
  const clock = torontoClock(now);
  if (isLocked(now)) lockAndReconcile(store, clock.day, now.getTime());
  if (!dayEligibleNow(store, clock.day, now.getTime())) return reply.code(409).send({ error: "The next complete day is not open yet" });
  if (isLocked(now)) return reply.code(409).send({ error: "Today is locked" });
  const line = String((request.body as { line?: unknown })?.line || "") as TrackedLine;
  if (!TRACKED_LINES.includes(line)) return reply.code(400).send({ error: "Choose one available line" });
  if (!store.putBet(id, clock.day, line, nowMs())) return reply.code(409).send({ error: "Today is locked" });
  return { bet: store.bet(id, clock.day) };
});

app.get("/api/history", async (request, reply) => {
  const id = requirePlayer(request, reply);
  if (!id) return;
  return { history: store.history(id) };
});

let lastPollAt = 0;
let lastPollOk = false;
let activePoll: Promise<void> | null = null;
let pollController: AbortController | null = null;
function poll(): Promise<void> {
  if (activePoll) return activePoll;
  const startedAt = nowMs();
  pollController = new AbortController();
  activePoll = (async () => {
    try {
      const statuses = await fetchTtcStatuses(ttcUrl, AbortSignal.any([pollController!.signal, AbortSignal.timeout(10_000)]));
      const receivedAt = nowMs();
      const day = torontoClock(new Date(receivedAt)).day;
      store.recordPoll(day, receivedAt, statuses, undefined, startedAt);
      if (isLocked(new Date(receivedAt))) lockAndReconcile(store, day, receivedAt);
      settlePreviousDays(store, day, receivedAt);
      lastPollAt = receivedAt;
      lastPollOk = true;
    } catch (error) {
      const receivedAt = nowMs();
      const day = torontoClock(new Date(receivedAt)).day;
      const message = error instanceof Error ? error.message : "Unknown TTC polling error";
      store.recordPoll(day, receivedAt, null, message, startedAt);
      app.log.error({ err: message }, "TTC poll failed");
      lastPollAt = receivedAt;
      lastPollOk = false;
    }
  })().finally(() => { activePoll = null; pollController = null; });
  return activePoll;
}

app.get("/healthz", async () => ({ ok: true, database: true, lastPollAt: lastPollAt || null, lastPollOk }));
app.get("/readyz", async (_request, reply) => {
  if (!lastPollOk || nowMs() - lastPollAt > pollMs * 3) return reply.code(503).send({ ready: false });
  return { ready: true };
});

const timer = setInterval(() => void poll(), pollMs);
timer.unref();
await poll();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    clearInterval(timer);
    pollController?.abort();
    try { await activePoll; } catch {}
    await app.close();
    store.close();
  });
}

await app.listen({ host: "0.0.0.0", port });
