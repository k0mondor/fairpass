import type { DatabaseConnection } from "../client.js";

export type IdempotencyState = "PENDING" | "CONFIRMED" | "FAILED";

export interface IdempotencyRecord {
  key: string;
  actorId: string;
  requestHash: string;
  eventId: string;
  state: IdempotencyState;
  txId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface IdempotencyRow {
  key: string;
  actor_id: string;
  request_hash: string;
  event_id: string;
  state: IdempotencyState;
  tx_id: string | null;
  created_at: string;
  updated_at: string;
}

const toRecord = (row: IdempotencyRow): IdempotencyRecord => ({
  key: row.key,
  actorId: row.actor_id,
  requestHash: row.request_hash,
  eventId: row.event_id,
  state: row.state,
  txId: row.tx_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class IdempotencyRepository {
  constructor(private readonly database: DatabaseConnection) {}

  findByKey(key: string): IdempotencyRecord | null {
    const row = this.database
      .prepare(
        `SELECT key, actor_id, request_hash, event_id, state, tx_id,
                created_at, updated_at
         FROM idempotency_keys
         WHERE key = ?`,
      )
      .get(key) as IdempotencyRow | undefined;

    return row ? toRecord(row) : null;
  }

  insert(record: IdempotencyRecord): void {
    this.database
      .prepare(
        `INSERT INTO idempotency_keys (
          key, actor_id, request_hash, event_id, state, tx_id,
          created_at, updated_at
        ) VALUES (
          @key, @actorId, @requestHash, @eventId, @state, @txId,
          @createdAt, @updatedAt
        )`,
      )
      .run(record);
  }

  rememberPendingTx(key: string, txId: string, updatedAt: string): void {
    this.database
      .prepare(
        `UPDATE idempotency_keys
         SET state = 'PENDING', tx_id = ?, updated_at = ?
         WHERE key = ?`,
      )
      .run(txId, updatedAt, key);
  }

  markConfirmed(key: string, txId: string, updatedAt: string): void {
    this.database
      .prepare(
        `UPDATE idempotency_keys
         SET state = 'CONFIRMED', tx_id = ?, updated_at = ?
         WHERE key = ?`,
      )
      .run(txId, updatedAt, key);
  }

  markFailed(key: string, updatedAt: string): void {
    this.database
      .prepare(
        `UPDATE idempotency_keys
         SET state = 'FAILED', updated_at = ?
         WHERE key = ?`,
      )
      .run(updatedAt, key);
  }
}
