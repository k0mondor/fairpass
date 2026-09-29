import type { DatabaseConnection } from "../client.js";
import type { EventStatus } from "../../types/domain.js";

export interface EventRecord {
  id: string;
  organizerId: string;
  title: string;
  description: string;
  location: string;
  capacity: number;
  registrationDeadline: string;
  startAt: string;
  endAt: string;
  status: EventStatus;
  storedStatus: EventStatus;
  registrationCount: number;
  winnerCount: number;
  drawWinnersHash: string | null;
  createdAt: string;
}

interface EventRow {
  id: string;
  organizer_id: string;
  title: string;
  description: string;
  location: string;
  capacity: number;
  registration_deadline: string;
  start_at: string;
  end_at: string;
  effective_status: EventStatus;
  stored_status: EventStatus;
  registration_count: number;
  winner_count: number;
  draw_winners_hash: string | null;
  created_at: string;
}

export interface EventListInput {
  page: number;
  pageSize: number;
  nowIso: string;
  organizerId?: string;
  status?: EventStatus;
}

export interface EventRecordPage {
  data: EventRecord[];
  total: number;
}

const effectiveStatusSql =
  "CASE WHEN e.end_at <= @nowIso THEN 'FINISHED' ELSE e.status END";

const selectSql = `
  SELECT
    e.id,
    e.organizer_id,
    e.title,
    e.description,
    e.location,
    e.capacity,
    e.registration_deadline,
    e.start_at,
    e.end_at,
    ${effectiveStatusSql} AS effective_status,
    e.status AS stored_status,
    (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id) AS registration_count,
    (SELECT COUNT(*) FROM draw_winners w WHERE w.event_id = e.id) AS winner_count,
    e.draw_winners_hash,
    e.created_at
  FROM events e
`;

const toRecord = (row: EventRow): EventRecord => ({
  id: row.id,
  organizerId: row.organizer_id,
  title: row.title,
  description: row.description,
  location: row.location,
  capacity: row.capacity,
  registrationDeadline: row.registration_deadline,
  startAt: row.start_at,
  endAt: row.end_at,
  status: row.effective_status,
  storedStatus: row.stored_status,
  registrationCount: row.registration_count,
  winnerCount: row.winner_count,
  drawWinnersHash: row.draw_winners_hash,
  createdAt: row.created_at,
});

export class EventRepository {
  constructor(private readonly database: DatabaseConnection) {}

  list(input: EventListInput): EventRecordPage {
    const conditions: string[] = [];
    const parameters: Record<string, string | number> = {
      nowIso: input.nowIso,
      pageSize: input.pageSize,
      offset: (input.page - 1) * input.pageSize,
    };

    if (input.organizerId) {
      conditions.push("e.organizer_id = @organizerId");
      parameters.organizerId = input.organizerId;
    }
    if (input.status) {
      conditions.push(`${effectiveStatusSql} = @status`);
      parameters.status = input.status;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.database
      .prepare(
        `${selectSql}
         ${where}
         ORDER BY e.created_at DESC, e.id DESC
         LIMIT @pageSize OFFSET @offset`,
      )
      .all(parameters) as EventRow[];
    const count = this.database
      .prepare(
        `SELECT COUNT(*) AS total
         FROM events e
         ${where}`,
      )
      .get(parameters) as { total: number };

    return { data: rows.map(toRecord), total: count.total };
  }

  findById(id: string, nowIso: string): EventRecord | null {
    const row = this.database
      .prepare(`${selectSql} WHERE e.id = @id`)
      .get({ id, nowIso }) as EventRow | undefined;

    return row ? toRecord(row) : null;
  }
}
