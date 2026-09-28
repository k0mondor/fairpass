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
    account: "student1",
    displayName: "学生一",
    role: "STUDENT",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    account: "student2",
    displayName: "学生二",
    role: "STUDENT",
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    account: "student3",
    displayName: "学生三",
    role: "STUDENT",
  },
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    account: "organizer1",
    displayName: "主办方一",
    role: "ORGANIZER",
  },
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    account: "inspector1",
    displayName: "检票员一",
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
