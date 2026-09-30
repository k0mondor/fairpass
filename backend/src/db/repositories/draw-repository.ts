import type { DatabaseConnection } from "../client.js";
import type { User } from "../../types/domain.js";

export type DrawAttemptState = "PENDING" | "CONFIRMED" | "CONFLICT";

export interface DrawAttemptRecord {
  eventId: string;
  winnerIdsJson: string;
  winnersHash: string;
  state: DrawAttemptState;
  txId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DrawAttemptRow {
  event_id: string;
  winner_ids_json: string;
  winners_hash: string;
  state: DrawAttemptState;
  tx_id: string | null;
  created_at: string;
  updated_at: string;
}

interface UserRow {
  id: string;
  display_name: string;
  role: User["role"];
}

const toAttempt = (row: DrawAttemptRow): DrawAttemptRecord => ({
  eventId: row.event_id,
  winnerIdsJson: row.winner_ids_json,
  winnersHash: row.winners_hash,
  state: row.state,
  txId: row.tx_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class DrawRepository {
  constructor(private readonly database: DatabaseConnection) {}

  findAttempt(eventId: string): DrawAttemptRecord | null {
    const row = this.database
      .prepare(
        `SELECT event_id, winner_ids_json, winners_hash, state, tx_id,
                created_at, updated_at
         FROM draw_attempts
         WHERE event_id = ?`,
      )
      .get(eventId) as DrawAttemptRow | undefined;
    return row ? toAttempt(row) : null;
  }

  insertAttempt(attempt: DrawAttemptRecord): void {
    this.database
      .prepare(
        `INSERT INTO draw_attempts (
          event_id, winner_ids_json, winners_hash, state, tx_id,
          created_at, updated_at
        ) VALUES (
          @eventId, @winnerIdsJson, @winnersHash, @state, @txId,
          @createdAt, @updatedAt
        )`,
      )
      .run(attempt);
  }

  listRegistrationUserIds(eventId: string): string[] {
    const rows = this.database
      .prepare(
        `SELECT user_id
         FROM registrations
         WHERE event_id = ?
         ORDER BY user_id ASC`,
      )
      .all(eventId) as { user_id: string }[];
    return rows.map(({ user_id }) => user_id);
  }

  setEventDrawing(eventId: string): boolean {
    const result = this.database
      .prepare(
        `UPDATE events
         SET status = 'DRAWING'
         WHERE id = ? AND status = 'OPEN'`,
      )
      .run(eventId);
    return result.changes === 1;
  }

  rememberPendingTx(eventId: string, txId: string, updatedAt: string): void {
    this.database
      .prepare(
        `UPDATE draw_attempts
         SET tx_id = ?, updated_at = ?
         WHERE event_id = ? AND state = 'PENDING'`,
      )
      .run(txId, updatedAt, eventId);
  }

  markConflict(eventId: string, updatedAt: string): void {
    this.database
      .prepare(
        `UPDATE draw_attempts
         SET state = 'CONFLICT', updated_at = ?
         WHERE event_id = ? AND state <> 'CONFIRMED'`,
      )
      .run(updatedAt, eventId);
  }

  complete(
    eventId: string,
    winnerIds: readonly string[],
    winnersHash: string,
    txId: string,
    updatedAt: string,
  ): void {
    this.database
      .prepare("DELETE FROM draw_winners WHERE event_id = ?")
      .run(eventId);
    this.database
      .prepare(
        `UPDATE registrations
         SET status = 'LOST'
         WHERE event_id = ?`,
      )
      .run(eventId);

    const insertWinner = this.database.prepare(
      `INSERT INTO draw_winners (event_id, user_id) VALUES (?, ?)`,
    );
    const markWinner = this.database.prepare(
      `UPDATE registrations
       SET status = 'WON'
       WHERE event_id = ? AND user_id = ?`,
    );
    for (const userId of winnerIds) {
      insertWinner.run(eventId, userId);
      const result = markWinner.run(eventId, userId);
      if (result.changes !== 1) {
        throw new Error("Persisted draw winner is not in the registration snapshot");
      }
    }

    const eventResult = this.database
      .prepare(
        `UPDATE events
         SET status = 'DRAWN', draw_winners_hash = ?, draw_tx_id = ?
         WHERE id = ? AND status IN ('DRAWING', 'DRAWN')`,
      )
      .run(winnersHash, txId, eventId);
    if (eventResult.changes !== 1) {
      throw new Error("Event is not in a completable draw state");
    }

    const attemptResult = this.database
      .prepare(
        `UPDATE draw_attempts
         SET state = 'CONFIRMED', tx_id = ?, updated_at = ?
         WHERE event_id = ? AND winner_ids_json = ? AND winners_hash = ?
           AND state IN ('PENDING', 'CONFIRMED')`,
      )
      .run(txId, updatedAt, eventId, JSON.stringify(winnerIds), winnersHash);
    if (attemptResult.changes !== 1) {
      throw new Error("Draw attempt no longer matches the persisted winner snapshot");
    }
  }

  listConfirmedWinners(eventId: string): User[] {
    const rows = this.database
      .prepare(
        `SELECT u.id, u.display_name, u.role
         FROM draw_winners w
         JOIN users u ON u.id = w.user_id
         WHERE w.event_id = ?
         ORDER BY u.id ASC`,
      )
      .all(eventId) as UserRow[];
    return rows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      role: row.role,
    }));
  }
}
