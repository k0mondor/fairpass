import type { DatabaseConnection } from "../client.js";
import type { Role, User } from "../../types/domain.js";

interface UserRow {
  id: string;
  display_name: string;
  role: Role;
}

const toUser = (row: UserRow): User => ({
  id: row.id,
  displayName: row.display_name,
  role: row.role,
});

export class UserRepository {
  constructor(private readonly database: DatabaseConnection) {}

  findByAccount(account: string): User | null {
    const row = this.database
      .prepare(
        `SELECT id, display_name, role
         FROM users
         WHERE account = ? COLLATE NOCASE`,
      )
      .get(account) as UserRow | undefined;

    return row ? toUser(row) : null;
  }

  findById(id: string): User | null {
    const row = this.database
      .prepare(
        `SELECT id, display_name, role
         FROM users
         WHERE id = ?`,
      )
      .get(id) as UserRow | undefined;

    return row ? toUser(row) : null;
  }
}
