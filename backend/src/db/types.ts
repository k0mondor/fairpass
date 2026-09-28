import type { DatabaseConnection } from "./client.js";

export interface Migration {
  version: number;
  name: string;
  up(database: DatabaseConnection): void;
}

export interface MigrationResult {
  applied: string[];
  currentVersion: number;
}
