import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import Database from "better-sqlite3";

export type DatabaseConnection = Database.Database;

const prepareDatabasePath = (filename: string): string => {
  if (filename === ":memory:") return filename;

  const absolutePath = resolve(filename);
  mkdirSync(dirname(absolutePath), { recursive: true });
  return absolutePath;
};

export const openDatabase = (filename: string): DatabaseConnection => {
  const database = new Database(prepareDatabasePath(filename));

  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  database.pragma("journal_mode = WAL");
  database.pragma("synchronous = NORMAL");

  return database;
};
