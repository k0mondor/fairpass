import type { DatabaseConnection } from "../client.js";
import type { Registration, RegistrationStatus } from "../../types/domain.js";

interface RegistrationRow {
  id: string;
  event_id: string;
  user_id: string;
  status: RegistrationStatus;
  created_at: string;
}

export interface RegistrationPage {
  data: Registration[];
  total: number;
}

const toRegistration = (row: RegistrationRow): Registration => ({
  id: row.id,
  eventId: row.event_id,
  userId: row.user_id,
  status: row.status,
  createdAt: row.created_at,
});

export class RegistrationRepository {
  constructor(private readonly database: DatabaseConnection) {}

  findByEventAndUser(eventId: string, userId: string): Registration | null {
    const row = this.database
      .prepare(
        `SELECT id, event_id, user_id, status, created_at
         FROM registrations
         WHERE event_id = ? AND user_id = ?`,
      )
      .get(eventId, userId) as RegistrationRow | undefined;

    return row ? toRegistration(row) : null;
  }

  countByEvent(eventId: string): number {
    const row = this.database
      .prepare("SELECT COUNT(*) AS count FROM registrations WHERE event_id = ?")
      .get(eventId) as { count: number };
    return row.count;
  }

  insert(registration: Registration): Registration {
    this.database
      .prepare(
        `INSERT INTO registrations (id, event_id, user_id, status, created_at)
         VALUES (@id, @eventId, @userId, @status, @createdAt)`,
      )
      .run(registration);
    return registration;
  }

  listByUser(userId: string, page: number, pageSize: number): RegistrationPage {
    const parameters = {
      userId,
      pageSize,
      offset: (page - 1) * pageSize,
    };
    const rows = this.database
      .prepare(
        `SELECT id, event_id, user_id, status, created_at
         FROM registrations
         WHERE user_id = @userId
         ORDER BY created_at DESC, id DESC
         LIMIT @pageSize OFFSET @offset`,
      )
      .all(parameters) as RegistrationRow[];
    const count = this.database
      .prepare(
        "SELECT COUNT(*) AS total FROM registrations WHERE user_id = @userId",
      )
      .get(parameters) as { total: number };

    return { data: rows.map(toRegistration), total: count.total };
  }
}
