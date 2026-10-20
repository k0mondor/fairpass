import { afterEach, describe, expect, it } from "vitest";

import { openDatabase, type DatabaseConnection } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";
import { demoUsers, seedDemoUsers } from "../src/db/seed.js";

let database: DatabaseConnection | undefined;

afterEach(() => {
  if (database?.open) database.close();
  database = undefined;
});

describe("demo user seed", () => {
  it("enforces one unique username regardless of letter case", () => {
    database = openDatabase(":memory:");
    runMigrations(database);
    seedDemoUsers(database);
    expect(() =>
      database!
        .prepare(
          "INSERT INTO users (id, account, display_name, role) VALUES (?, ?, ?, ?)",
        )
        .run("another-user", "ALEX", "Different person", "STUDENT"),
    ).toThrow(/UNIQUE/);
  });
  it("creates all role accounts and remains idempotent", () => {
    database = openDatabase(":memory:");
    runMigrations(database);

    expect(seedDemoUsers(database)).toBe(5);
    expect(seedDemoUsers(database)).toBe(5);

    const users = database
      .prepare("SELECT account, role FROM users ORDER BY account")
      .all() as Array<{ account: string; role: string }>;
    expect(users).toHaveLength(5);
    expect(users).toEqual(
      expect.arrayContaining([
        { account: "alex", role: "STUDENT" },
        { account: "jamie", role: "STUDENT" },
        { account: "casey", role: "STUDENT" },
        { account: "morgan", role: "ORGANIZER" },
        { account: "taylor", role: "INSPECTOR" },
      ]),
    );
    expect(demoUsers.map(({ id }) => id)).toHaveLength(
      new Set(demoUsers.map(({ id }) => id)).size,
    );
  });
});
