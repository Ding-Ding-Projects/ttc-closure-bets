import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import staticPlugin from "@fastify/static";
import { Store } from "./database.js";
import { applyImmediateSettlements, coverageComplete, dayEligibleNow, displayDay, lineMetadata, settlePreviousDays } from "./settlement.js";
import { fetchTtcStatuses, TRACKED_LINES, type TrackedLine } from "./ttc.js";
import { isLocked, torontoClock } from "./time.js";

const port = Number(process.env.PORT || 3000);
const databasePath = process.env.DATABASE_PATH || ".data/ttc-closure-bets.sqlite";
const ttcUrl = process.env.TTC_STATUS_URL || "https://www.ttc.ca/";
const pollMs = Math.max(30_000, Number(process.env.POLL_INTERVAL_MS || 60_000));
const store = new Store(databasePath);
const app = Fastify({ logger: true, bodyLimit: 16_384, trustProxy: true });
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
});

function playerId(request: { cookies: Record<string, string | undefined> }): string | undefined {
  return request.cookies.ttc_player;
}

function requirePlayer(request: { cookies: Record<string, string | undefined> }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }): string | undefined {
  const id = playerId(request);
  if (!id || !store.player(id)) {
    reply.code(401).send({ error: "Choose a nickname first" });
    return undefined;
  }
  return id;
}

function requireSameOrigin(request: { headers: Record<string, string | string[] | undefined>; hostname: string }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    if (new URL(String(origin)).hostname === request.hostname) return true;
  } catch {}
  reply.code(403).send({ error: "Origin refused" });
  return false;
}

app.get("/api/today", async (request) => {
  const now = new Date();
  const clock = torontoClock(now);
  const day = displayDay(store, now);
  const locked = day === clock.day ? isLocked(now) : false;
  const id = playerId(request);
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
    profile: id ? store.player(id) : null,
    bet: bet ?? null,
    board: locked ? store.board(day) : [],
    coverageComplete: day < clock.day ? coverageComplete(store, day) : false
  };
});

app.put("/api/profile", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
  if (!requireSameOrigin(request, reply)) return;
  const nickname = typeof (request.body as { nickname?: unknown })?.nickname === "string" ? (request.body as { nickname: string }).nickname.normalize("NFC").trim() : "";
  if (!nickname || [...nickname].length > 32 || Buffer.byteLength(nickname, "utf8") > 128 || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/i.test(nickname)) {
    return reply.code(400).send({ error: "Nickname must be 1 to 32 visible characters" });
  }
  const id = playerId(request) || randomUUID();
  store.upsertPlayer(id, nickname, Date.now());
  reply.setCookie("ttc_player", id, { path: "/", httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
  return { nickname };
});

app.put("/api/bet", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
  if (!requireSameOrigin(request, reply)) return;
  const id = requirePlayer(request, reply);
  if (!id) return;
  const now = new Date();
  const clock = torontoClock(now);
  if (!dayEligibleNow(store, clock.day, now.getTime())) return reply.code(409).send({ error: "The next complete day is not open yet" });
  if (isLocked(now)) return reply.code(409).send({ error: "Today is locked" });
  const line = String((request.body as { line?: unknown })?.line || "") as TrackedLine;
  if (!TRACKED_LINES.includes(line)) return reply.code(400).send({ error: "Choose one available line" });
  store.putBet(id, clock.day, line, Date.now());
  return { bet: store.bet(id, clock.day) };
});

app.get("/api/history", async (request, reply) => {
  const id = requirePlayer(request, reply);
  if (!id) return;
  return { history: store.history(id) };
});

let lastPollAt = 0;
let lastPollOk = false;
let polling = false;
async function poll(): Promise<void> {
  if (polling) return;
  polling = true;
  const now = Date.now();
  const day = torontoClock(new Date(now)).day;
  try {
    const statuses = await fetchTtcStatuses(ttcUrl, AbortSignal.timeout(10_000));
    store.recordPoll(day, now, statuses);
    applyImmediateSettlements(store, day, statuses, now);
    lastPollOk = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown TTC polling error";
    store.recordPoll(day, now, null, message);
    app.log.error({ err: message }, "TTC poll failed");
    lastPollOk = false;
  } finally {
    lastPollAt = now;
    settlePreviousDays(store, day, now);
    polling = false;
  }
}

app.get("/healthz", async () => ({ ok: true, database: true, lastPollAt: lastPollAt || null, lastPollOk }));
app.get("/readyz", async (_request, reply) => {
  if (!lastPollOk || Date.now() - lastPollAt > pollMs * 3) return reply.code(503).send({ ready: false });
  return { ready: true };
});

const timer = setInterval(() => void poll(), pollMs);
timer.unref();
await poll();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    clearInterval(timer);
    await app.close();
    store.close();
    process.exit(0);
  });
}

await app.listen({ host: "0.0.0.0", port });
