import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function ttcHtml(): string {
  return ["1", "2", "4", "5", "6"].map((line) => `<div class="subway-line-group"><a href="/routes-and-schedules/${line}/0">${line}</a><div class="alert-title">Normal service</div></div>`).join("");
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server did not receive a TCP port");
  return address.port;
}

async function freePort(): Promise<number> {
  const probe = createServer();
  const port = await listen(probe);
  await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitFor(url: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Service exited early with ${child.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for the service");
}

test("real HTTP service handles profile, prediction revision, origin refusal, and history", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ttc-http-"));
  const source = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(ttcHtml());
  });
  const sourcePort = await listen(source);
  const appPort = await freePort();
  let output = "";
  const child = spawn(process.execPath, ["dist/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "test",
      TEST_NOW: "2026-08-25T04:01:00.000Z",
      PORT: String(appPort),
      DATABASE_PATH: join(directory, "integration.sqlite"),
      TTC_STATUS_URL: `http://127.0.0.1:${sourcePort}/`,
      PUBLIC_ORIGIN: `http://127.0.0.1:${appPort}`,
      POLL_INTERVAL_MS: "60000"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout?.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr?.on("data", (chunk) => { output += chunk.toString(); });

  try {
    const base = `http://127.0.0.1:${appPort}`;
    await waitFor(`${base}/readyz`, child);

    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);

    const profile = await fetch(`${base}/api/profile`, {
      method: "PUT",
      headers: { "content-type": "application/json", origin: base, "sec-fetch-site": "same-origin" },
      body: JSON.stringify({ nickname: "Mystery Rider" })
    });
    assert.equal(profile.status, 200);
    const cookie = (profile.headers.get("set-cookie") || "").split(";", 1)[0];
    assert.match(cookie, /^ttc_player=/);

    const refused = await fetch(`${base}/api/bet`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie, origin: "https://example.invalid" },
      body: JSON.stringify({ line: "6" })
    });
    assert.equal(refused.status, 403);

    for (const line of ["6", "2"]) {
      const bet = await fetch(`${base}/api/bet`, {
        method: "PUT",
        headers: { "content-type": "application/json", cookie, origin: base, "sec-fetch-site": "same-origin" },
        body: JSON.stringify({ line })
      });
      assert.equal(bet.status, 200);
    }

    const todayResponse = await fetch(`${base}/api/today`, { headers: { cookie } });
    assert.equal(todayResponse.headers.get("cache-control"), "private, no-store");
    const today = await todayResponse.json() as { eligible: boolean; statuses: unknown[]; bet: { line: string }; profile: Record<string, unknown> };
    assert.equal(today.eligible, true);
    assert.equal(today.statuses.length, 5);
    assert.equal(today.bet.line, "2");
    assert.deepEqual(Object.keys(today.profile), ["nickname"]);

    const history = await fetch(`${base}/api/history`, { headers: { cookie } }).then((response) => response.json()) as { history: { line: string }[] };
    assert.equal(history.history.length, 1);
    assert.equal(history.history[0].line, "2");
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nService output:\n${output}`);
  } finally {
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    await new Promise<void>((resolve) => source.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});
