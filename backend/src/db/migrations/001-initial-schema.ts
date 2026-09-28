import type { Migration } from "../types.js";

export const initialSchema: Migration = {
  version: 1,
  name: "initial_schema",
  up(database) {
    database.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        account TEXT NOT NULL COLLATE NOCASE UNIQUE,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('STUDENT', 'ORGANIZER', 'INSPECTOR'))
      );

      CREATE TABLE events (
        id TEXT PRIMARY KEY,
        organizer_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        location TEXT NOT NULL,
        capacity INTEGER NOT NULL CHECK (capacity > 0),
        registration_deadline TEXT NOT NULL,
        start_at TEXT NOT NULL,
        end_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('OPEN', 'DRAWING', 'DRAWN', 'FINISHED')),
        created_at TEXT NOT NULL,
        draw_winners_hash TEXT NULL CHECK (
          draw_winners_hash IS NULL OR
          (length(draw_winners_hash) = 64 AND draw_winners_hash NOT GLOB '*[^0-9a-f]*')
        ),
        draw_tx_id TEXT NULL,
        FOREIGN KEY (organizer_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        CHECK (registration_deadline < start_at),
        CHECK (start_at < end_at)
      );

      CREATE TABLE registrations (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('REGISTERED', 'WON', 'LOST')),
        created_at TEXT NOT NULL,
        FOREIGN KEY (event_id) REFERENCES events(id) ON UPDATE CASCADE ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        UNIQUE (event_id, user_id)
      );

      CREATE TABLE draw_winners (
        event_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        FOREIGN KEY (event_id) REFERENCES events(id) ON UPDATE CASCADE ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        PRIMARY KEY (event_id, user_id)
      );

      CREATE TABLE draw_attempts (
        event_id TEXT PRIMARY KEY,
        winner_ids_json TEXT NOT NULL,
        winners_hash TEXT NOT NULL CHECK (
          length(winners_hash) = 64 AND winners_hash NOT GLOB '*[^0-9a-f]*'
        ),
        state TEXT NOT NULL CHECK (state IN ('PENDING', 'CONFIRMED', 'CONFLICT')),
        tx_id TEXT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (event_id) REFERENCES events(id) ON UPDATE CASCADE ON DELETE CASCADE
      );

      CREATE TABLE idempotency_keys (
        key TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        request_hash TEXT NOT NULL CHECK (
          length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'
        ),
        event_id TEXT NOT NULL UNIQUE,
        state TEXT NOT NULL CHECK (state IN ('PENDING', 'CONFIRMED', 'FAILED')),
        tx_id TEXT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (actor_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT
      );

      CREATE INDEX idx_events_created_id
        ON events(created_at DESC, id DESC);
      CREATE INDEX idx_events_organizer_created_id
        ON events(organizer_id, created_at DESC, id DESC);
      CREATE INDEX idx_events_organizer_status_created_id
        ON events(organizer_id, status, created_at DESC, id DESC);
      CREATE INDEX idx_events_status_created_id
        ON events(status, created_at DESC, id DESC);

      CREATE INDEX idx_registrations_event_created_id
        ON registrations(event_id, created_at DESC, id DESC);
      CREATE INDEX idx_registrations_event_status
        ON registrations(event_id, status);
      CREATE INDEX idx_registrations_user_created_id
        ON registrations(user_id, created_at DESC, id DESC);

      CREATE INDEX idx_draw_winners_user_event
        ON draw_winners(user_id, event_id);
      CREATE INDEX idx_draw_attempts_state_updated
        ON draw_attempts(state, updated_at);
      CREATE INDEX idx_idempotency_state_updated
        ON idempotency_keys(state, updated_at);
    `);
  },
};
