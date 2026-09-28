import { initialSchema } from "./migrations/001-initial-schema.js";
import type { DatabaseConnection } from "./client.js";
import type { Migration, MigrationResult } from "./types.js";

interface AppliedMigration {
  version: number;
  name: string;
}

export const migrations: readonly Migration[] = [initialSchema];

const ensureMigrationTable = (database: DatabaseConnection) => {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    );
  `);
};

export const runMigrations = (database: DatabaseConnection): MigrationResult => {
  ensureMigrationTable(database);

  const appliedRows = database
    .prepare("SELECT version, name FROM schema_migrations ORDER BY version")
    .all() as AppliedMigration[];
  const knownByVersion = new Map(
    migrations.map((migration) => [migration.version, migration]),
  );

  for (const applied of appliedRows) {
    const known = knownByVersion.get(applied.version);
    if (!known || known.name !== applied.name) {
      throw new Error(
        `Unknown or renamed database migration: ${applied.version} ${applied.name}`,
      );
    }
  }

  const appliedVersions = new Set(appliedRows.map((row) => row.version));
  const newlyApplied: string[] = [];
  const applyMigration = database.transaction((migration: Migration) => {
    migration.up(database);
    database
      .prepare(
        `INSERT INTO schema_migrations (version, name, applied_at)
         VALUES (?, ?, ?)`,
      )
      .run(migration.version, migration.name, new Date().toISOString());
  });

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) continue;

    applyMigration(migration);
    newlyApplied.push(migration.name);
  }

  const currentVersion =
    migrations.length === 0 ? 0 : Math.max(...migrations.map(({ version }) => version));

  return { applied: newlyApplied, currentVersion };
};
