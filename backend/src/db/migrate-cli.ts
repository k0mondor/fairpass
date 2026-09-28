import "dotenv/config";

import { openDatabase } from "./client.js";
import { runMigrations } from "./migrate.js";

const filename = process.env.SQLITE_PATH ?? "./data/fairpass.sqlite";
const database = openDatabase(filename);

try {
  const result = runMigrations(database);
  const detail =
    result.applied.length > 0
      ? `applied ${result.applied.join(", ")}`
      : "database already up to date";

  console.info(`SQLite migration version ${result.currentVersion}: ${detail}`);
} finally {
  database.close();
}
