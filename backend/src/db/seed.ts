import type { DatabaseConnection } from "./client.js";
import type { Role } from "../types/domain.js";

export interface DemoUserSeed {
  id: string;
  account: string;
  displayName: string;
  role: Role;
}

export const demoUsers: readonly DemoUserSeed[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    account: "alex",
    displayName: "alex",
    role: "STUDENT",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    account: "jamie",
    displayName: "jamie",
    role: "STUDENT",
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    account: "casey",
    displayName: "casey",
    role: "STUDENT",
  },
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    account: "morgan",
    displayName: "morgan",
    role: "ORGANIZER",
  },
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    account: "taylor",
    displayName: "taylor",
    role: "INSPECTOR",
  },
];

export const seedDemoUsers = (database: DatabaseConnection): number => {
  const upsert = database.prepare(`
    INSERT INTO users (id, account, display_name, role)
    VALUES (@id, @account, @displayName, @role)
    ON CONFLICT(id) DO UPDATE SET
      account = excluded.account,
      display_name = excluded.display_name,
      role = excluded.role
  `);
  const seed = database.transaction(() => {
    for (const user of demoUsers) upsert.run(user);
  });

  seed();
  return demoUsers.length;
};
