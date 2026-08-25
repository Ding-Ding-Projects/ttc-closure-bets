import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { LineStatus, TrackedLine } from "./ttc.js";

export type BetResult = "pending" | "won" | "lost" | "unresolved";

export class Store {
  readonly db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        nickname TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS bets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        day TEXT NOT NULL,
        line TEXT NOT NULL CHECK(line IN ('1','2','4','5','6')),
        prediction TEXT NOT NULL CHECK(prediction IN ('disrupted','normal')),
        revised_at INTEGER NOT NULL,
        locked_at INTEGER,
        result TEXT NOT NULL DEFAULT 'pending' CHECK(result IN ('pending','won','lost','unresolved')),
        settled_at INTEGER,
        UNIQUE(player_id, day)
      );
      CREATE TABLE IF NOT EXISTS polls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        day TEXT NOT NULL,
        checked_at INTEGER NOT NULL,
        success INTEGER NOT NULL,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS polls_day_time ON polls(day, checked_at);
      CREATE TABLE IF NOT EXISTS observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
        day TEXT NOT NULL,
        line TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        normal INTEGER NOT NULL,
        checked_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS observations_day_line ON observations(day, line, checked_at);
    `);
  }

  close(): void { this.db.close(); }

  upsertPlayer(id: string, nickname: string, now: number): void {
    this.db.prepare(`INSERT INTO players(id,nickname,created_at,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET nickname=excluded.nickname,updated_at=excluded.updated_at`).run(id, nickname, now, now);
  }

  player(id: string): Record<string, unknown> | undefined {
    return this.db.prepare("SELECT id,nickname,created_at,updated_at FROM players WHERE id=?").get(id) as Record<string, unknown> | undefined;
  }

  putBet(playerId: string, day: string, line: TrackedLine, now: number): void {
    const prediction = line === "6" ? "normal" : "disrupted";
    this.db.prepare(`INSERT INTO bets(player_id,day,line,prediction,revised_at) VALUES(?,?,?,?,?)
      ON CONFLICT(player_id,day) DO UPDATE SET line=excluded.line,prediction=excluded.prediction,revised_at=excluded.revised_at
      WHERE bets.result='pending'`).run(playerId, day, line, prediction, now);
  }

  bet(playerId: string, day: string): Record<string, unknown> | undefined {
    return this.db.prepare("SELECT day,line,prediction,revised_at,locked_at,result,settled_at FROM bets WHERE player_id=? AND day=?").get(playerId, day) as Record<string, unknown> | undefined;
  }

  history(playerId: string): Record<string, unknown>[] {
    return this.db.prepare("SELECT day,line,prediction,revised_at,result,settled_at FROM bets WHERE player_id=? ORDER BY day DESC LIMIT 60").all(playerId) as Record<string, unknown>[];
  }

  board(day: string): Record<string, unknown>[] {
    return this.db.prepare(`SELECT p.nickname,b.line,b.prediction,b.result,b.revised_at,b.settled_at
      FROM bets b JOIN players p ON p.id=b.player_id WHERE b.day=? ORDER BY b.revised_at`).all(day) as Record<string, unknown>[];
  }

  recordPoll(day: string, checkedAt: number, statuses: LineStatus[] | null, error?: string): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const poll = this.db.prepare("INSERT INTO polls(day,checked_at,success,error) VALUES(?,?,?,?)")
        .run(day, checkedAt, statuses ? 1 : 0, error?.slice(0, 500) ?? null);
      if (statuses) {
        const insert = this.db.prepare("INSERT INTO observations(poll_id,day,line,title,description,normal,checked_at) VALUES(?,?,?,?,?,?,?)");
        for (const status of statuses) insert.run(poll.lastInsertRowid, day, status.line, status.title, status.description, status.normal ? 1 : 0, checkedAt);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  firstSuccessfulPoll(day: string): number | null {
    const row = this.db.prepare("SELECT MIN(checked_at) value FROM polls WHERE day=? AND success=1").get(day) as { value: number | null };
    return row.value;
  }

  currentStatuses(day: string): Record<string, unknown>[] {
    return this.db.prepare(`SELECT o.line,o.title,o.description,o.normal,o.checked_at FROM observations o
      JOIN (SELECT line,MAX(checked_at) checked_at FROM observations WHERE day=? GROUP BY line) latest
      ON latest.line=o.line AND latest.checked_at=o.checked_at WHERE o.day=? ORDER BY CAST(o.line AS INTEGER)`).all(day, day) as Record<string, unknown>[];
  }

  disrupted(day: string, line: TrackedLine): boolean {
    return Boolean(this.db.prepare("SELECT 1 found FROM observations WHERE day=? AND line=? AND normal=0 LIMIT 1").get(day, line));
  }

  successfulPollTimes(day: string): number[] {
    return (this.db.prepare("SELECT checked_at FROM polls WHERE day=? AND success=1 ORDER BY checked_at").all(day) as { checked_at: number }[]).map((row) => row.checked_at);
  }

  settleImmediate(day: string, line: TrackedLine, now: number): void {
    if (line === "6") {
      this.db.prepare("UPDATE bets SET result='lost',settled_at=? WHERE day=? AND line='6' AND result='pending'").run(now, day);
    } else {
      this.db.prepare("UPDATE bets SET result='won',settled_at=? WHERE day=? AND line=? AND result='pending'").run(now, day, line);
    }
  }

  settleEndOfDay(day: string, complete: boolean, now: number): void {
    if (!complete) {
      this.db.prepare("UPDATE bets SET result='unresolved',settled_at=? WHERE day=? AND result='pending'").run(now, day);
      return;
    }
    this.db.prepare("UPDATE bets SET result='lost',settled_at=? WHERE day=? AND line!='6' AND result='pending'").run(now, day);
    this.db.prepare("UPDATE bets SET result='won',settled_at=? WHERE day=? AND line='6' AND result='pending'").run(now, day);
  }
}
