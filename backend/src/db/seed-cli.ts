import "dotenv/config";

import { openDatabase } from "./client.js";
import { runMigrations } from "./migrate.js";
import { seedDemoUsers } from "./seed.js";

const filename = process.env.SQLITE_PATH ?? "./data/fairpass.sqlite";
const database = openDatabase(filename);

try {
  runMigrations(database);
  const count = seedDemoUsers(database);
  console.info(`Seeded ${count} demo users.`);
} finally {
  database.close();
}
