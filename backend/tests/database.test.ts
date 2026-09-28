import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { openDatabase, type DatabaseConnection } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";

const openDatabases: DatabaseConnection[] = [];
const temporaryDirectories: string[] = [];

const createDatabase = () => {
  const database = openDatabase(":memory:");
  openDatabases.push(database);
  return database;
};

const insertFixtureUsers = (database: DatabaseConnection) => {
  const insert = database.prepare(
    "INSERT INTO users (id, account, display_name, role) VALUES (?, ?, ?, ?)",
  );
  insert.run("organizer-1", "organizer1", "主办方一", "ORGANIZER");
  insert.run("student-1", "student1", "学生一", "STUDENT");
};

const insertFixtureEvent = (database: DatabaseConnection) => {
  database
    .prepare(
      `INSERT INTO events (
        id, organizer_id, title, description, location, capacity,
        registration_deadline, start_at, end_at, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "event-1",
      "organizer-1",
      "测试活动",
      "数据库约束测试",
      "Hall A",
      2,
      "2026-10-01T10:00:00.000Z",
      "2026-10-02T10:00:00.000Z",
      "2026-10-02T12:00:00.000Z",
      "OPEN",
      "2026-09-29T00:00:00.000Z",
    );
};

afterEach(() => {
  for (const database of openDatabases.splice(0)) {
    if (database.open) database.close();
  }
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("SQLite migrations", () => {
  it("enables foreign keys on every connection", () => {
    const database = createDatabase();

    expect(database.pragma("foreign_keys", { simple: true })).toBe(1);
  });

  it("creates every required table and index", () => {
    const database = createDatabase();
    runMigrations(database);

    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tables).toEqual(
      expect.arrayContaining([
        "draw_attempts",
        "draw_winners",
        "events",
        "idempotency_keys",
        "registrations",
        "schema_migrations",
        "users",
      ]),
    );

    const indexes = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(indexes).toEqual(
      expect.arrayContaining([
        "idx_events_organizer_created_id",
        "idx_events_status_created_id",
        "idx_registrations_event_created_id",
        "idx_registrations_user_created_id",
      ]),
    );
  });

  it("is repeatable without applying the same migration twice", () => {
    const database = createDatabase();

    expect(runMigrations(database)).toEqual({
      applied: ["initial_schema"],
      currentVersion: 1,
    });
    expect(runMigrations(database)).toEqual({ applied: [], currentVersion: 1 });

    const count = database
      .prepare("SELECT COUNT(*) AS count FROM schema_migrations")
      .get() as { count: number };
    expect(count.count).toBe(1);
  });

  it("enforces foreign keys and unique registrations", () => {
    const database = createDatabase();
    runMigrations(database);
    insertFixtureUsers(database);
    insertFixtureEvent(database);

    expect(() =>
      database
        .prepare(
          `INSERT INTO registrations
           (id, event_id, user_id, status, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          "registration-invalid",
          "missing-event",
          "student-1",
          "REGISTERED",
          "2026-09-29T01:00:00.000Z",
        ),
    ).toThrow(/FOREIGN KEY/);

    const insertRegistration = database.prepare(
      `INSERT INTO registrations
       (id, event_id, user_id, status, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    insertRegistration.run(
      "registration-1",
      "event-1",
      "student-1",
      "REGISTERED",
      "2026-09-29T01:00:00.000Z",
    );
    expect(() =>
      insertRegistration.run(
        "registration-2",
        "event-1",
        "student-1",
        "REGISTERED",
        "2026-09-29T01:01:00.000Z",
      ),
    ).toThrow(/UNIQUE/);
  });

  it("allows only one durable draw attempt per event", () => {
    const database = createDatabase();
    runMigrations(database);
    insertFixtureUsers(database);
    insertFixtureEvent(database);

    const insertAttempt = database.prepare(
      `INSERT INTO draw_attempts (
        event_id, winner_ids_json, winners_hash, state, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const hash = "a".repeat(64);
    insertAttempt.run(
      "event-1",
      '["student-1"]',
      hash,
      "PENDING",
      "2026-09-29T02:00:00.000Z",
      "2026-09-29T02:00:00.000Z",
    );

    expect(() =>
      insertAttempt.run(
        "event-1",
        "[]",
        "b".repeat(64),
        "PENDING",
        "2026-09-29T02:01:00.000Z",
        "2026-09-29T02:01:00.000Z",
      ),
    ).toThrow(/UNIQUE/);
  });

  it("persists data across file-backed database restarts", () => {
    const directory = mkdtempSync(join(tmpdir(), "fairpass-db-"));
    temporaryDirectories.push(directory);
    const filename = join(directory, "fairpass.sqlite");

    const first = openDatabase(filename);
    openDatabases.push(first);
    runMigrations(first);
    insertFixtureUsers(first);
    first.close();

    const second = openDatabase(filename);
    openDatabases.push(second);
    expect(runMigrations(second).applied).toEqual([]);
    const user = second
      .prepare("SELECT account FROM users WHERE id = ?")
      .get("student-1") as { account: string };
    expect(user.account).toBe("student1");
  });
});
