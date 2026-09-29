import { Router } from "express";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import type { AuthConfig } from "../src/config/auth.js";
import { openDatabase, type DatabaseConnection } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";
import { EventRepository } from "../src/db/repositories/event-repository.js";
import { IdempotencyRepository } from "../src/db/repositories/idempotency-repository.js";
import { RegistrationRepository } from "../src/db/repositories/registration-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { seedDemoUsers } from "../src/db/seed.js";
import { MockGatewayAdapter } from "../src/fabric/mock-gateway-adapter.js";
import { createApiRouter } from "../src/routes/index.js";
import { AuthService } from "../src/services/auth-service.js";
import { DemoTokenService } from "../src/services/demo-token-service.js";
import { EventCreationService } from "../src/services/event-creation-service.js";
import { EventService } from "../src/services/event-service.js";
import {
  type LedgerReadService,
  type TicketCounts,
  UnavailableLedgerReadService,
} from "../src/services/ledger-read-service.js";
import { RegistrationService } from "../src/services/registration-service.js";
import type { EventStatus, Ticket } from "../src/types/domain.js";

const now = new Date("2026-09-29T00:00:00.000Z");
const httpConfig = {
  corsOrigins: ["http://127.0.0.1:5173"],
  jsonBodyLimit: "100kb",
};
const authConfig: AuthConfig = {
  secret: new TextEncoder().encode("test-secret-with-at-least-32-characters"),
  ttlSeconds: 3600,
  issuer: "fairpass-backend",
  audience: "fairpass-demo",
};
const silentLog = () => undefined;

const eventIds = {
  first: "10000000-0000-4000-8000-000000000001",
  second: "10000000-0000-4000-8000-000000000002",
  third: "10000000-0000-4000-8000-000000000003",
  closed: "10000000-0000-4000-8000-000000000004",
  drawing: "10000000-0000-4000-8000-000000000005",
  full: "10000000-0000-4000-8000-000000000006",
  drawn: "10000000-0000-4000-8000-000000000007",
} as const;

interface EventFixture {
  id: string;
  organizerId?: string;
  title?: string;
  registrationDeadline?: string;
  startAt?: string;
  endAt?: string;
  status?: EventStatus;
  createdAt?: string;
  drawWinnersHash?: string | null;
}

class FakeLedger implements LedgerReadService {
  counts = new Map<string, TicketCounts>();
  tickets = new Map<string, Ticket>();

  async getTicketCounts(eventId: string): Promise<TicketCounts> {
    return this.counts.get(eventId) ?? { issuedCount: 0, redeemedCount: 0 };
  }

  async findTicketByOwnerForEvent(
    ownerId: string,
    eventId: string,
  ): Promise<Ticket | null> {
    return this.tickets.get(`${ownerId}:${eventId}`) ?? null;
  }
}

interface TestContext {
  database: DatabaseConnection;
  app: ReturnType<typeof createApp>;
  registrations: RegistrationRepository;
}

const databases: DatabaseConnection[] = [];

const createContext = (
  ledger: LedgerReadService = new UnavailableLedgerReadService(),
): TestContext => {
  const database = openDatabase(":memory:");
  databases.push(database);
  runMigrations(database);
  seedDemoUsers(database);
  database
    .prepare(
      "INSERT INTO users (id, account, display_name, role) VALUES (?, ?, ?, ?)",
    )
    .run(
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      "organizer2",
      "主办方二",
      "ORGANIZER",
    );

  const users = new UserRepository(database);
  const eventRepository = new EventRepository(database);
  const idempotencyRepository = new IdempotencyRepository(database);
  const registrationRepository = new RegistrationRepository(database);
  const auth = new AuthService(
    users,
    new DemoTokenService(authConfig, () => Math.floor(now.getTime() / 1000)),
  );
  const events = new EventService(
    eventRepository,
    registrationRepository,
    ledger,
    () => new Date(now),
  );
  const gateway = new MockGatewayAdapter({
    channelName: "test-channel",
    chaincodeName: "fairpass",
    clock: () => new Date(now),
  });
  const eventCreation = new EventCreationService(
    database,
    eventRepository,
    idempotencyRepository,
    gateway,
    events,
    () => new Date(now),
  );
  const registrationService = new RegistrationService(
    database,
    registrationRepository,
    events,
    () => new Date(now),
  );
  const apiRouter = createApiRouter({
    auth,
    eventCreation,
    events,
    registrations: registrationService,
  });

  return {
    database,
    registrations: registrationRepository,
    app: createApp({ config: httpConfig, apiRouter, logSink: silentLog }),
  };
};

const insertEvent = (database: DatabaseConnection, fixture: EventFixture) => {
  database
    .prepare(
      `INSERT INTO events (
        id, organizer_id, title, description, location, capacity,
        registration_deadline, start_at, end_at, status, created_at,
        draw_winners_hash
      ) VALUES (
        @id, @organizerId, @title, @description, @location, @capacity,
        @registrationDeadline, @startAt, @endAt, @status, @createdAt,
        @drawWinnersHash
      )`,
    )
    .run({
      id: fixture.id,
      organizerId:
        fixture.organizerId ?? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      title: fixture.title ?? `Event ${fixture.id.slice(-1)}`,
      description: "Event description",
      location: "Hall A",
      capacity: 2,
      registrationDeadline:
        fixture.registrationDeadline ?? "2026-10-01T00:00:00.000Z",
      startAt: fixture.startAt ?? "2026-10-02T00:00:00.000Z",
      endAt: fixture.endAt ?? "2026-10-02T02:00:00.000Z",
      status: fixture.status ?? "OPEN",
      createdAt: fixture.createdAt ?? "2026-09-28T00:00:00.000Z",
      drawWinnersHash: fixture.drawWinnersHash ?? null,
    });
};

const login = async (app: TestContext["app"], account: string) => {
  const response = await request(app)
    .post("/api/v1/auth/demo-login")
    .send({ account });
  expect(response.status).toBe(200);
  return response.body.data.token as string;
};

afterEach(() => {
  for (const database of databases.splice(0)) {
    if (database.open) database.close();
  }
});

describe("event and registration API", () => {
  it("requires authentication and returns filtered, stable event pages", async () => {
    const context = createContext();
    insertEvent(context.database, {
      id: eventIds.first,
      createdAt: "2026-09-28T03:00:00.000Z",
    });
    insertEvent(context.database, {
      id: eventIds.second,
      organizerId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      createdAt: "2026-09-28T02:00:00.000Z",
    });
    insertEvent(context.database, {
      id: eventIds.third,
      registrationDeadline: "2026-09-20T00:00:00.000Z",
      startAt: "2026-09-21T00:00:00.000Z",
      endAt: "2026-09-22T00:00:00.000Z",
      createdAt: "2026-09-19T00:00:00.000Z",
    });
    context.registrations.insert({
      id: "20000000-0000-4000-8000-000000000001",
      eventId: eventIds.first,
      userId: "11111111-1111-4111-8111-111111111111",
      status: "REGISTERED",
      createdAt: "2026-09-28T04:00:00.000Z",
    });

    expect((await request(context.app).get("/api/v1/events")).status).toBe(401);
    const token = await login(context.app, "student1");
    const page = await request(context.app)
      .get("/api/v1/events?page=1&pageSize=2")
      .set("Authorization", `Bearer ${token}`);
    expect(page.status).toBe(200);
    expect(page.body.total).toBe(3);
    expect(page.body.data).toHaveLength(2);
    expect(page.body.data[0]).toMatchObject({
      id: eventIds.first,
      status: "OPEN",
      registrationCount: 1,
      winnerCount: 0,
      issuedCount: 0,
      redeemedCount: 0,
    });

    const finished = await request(context.app)
      .get("/api/v1/events?status=FINISHED")
      .set("Authorization", `Bearer ${token}`);
    expect(finished.body.total).toBe(1);
    expect(finished.body.data[0]).toMatchObject({
      id: eventIds.third,
      status: "FINISHED",
    });

    const invalid = await request(context.app)
      .get("/api/v1/events?pageSize=101")
      .set("Authorization", `Bearer ${token}`);
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("filters organizer events before pagination and total calculation", async () => {
    const context = createContext();
    insertEvent(context.database, { id: eventIds.first });
    insertEvent(context.database, {
      id: eventIds.second,
      createdAt: "2026-09-27T00:00:00.000Z",
    });
    insertEvent(context.database, {
      id: eventIds.third,
      organizerId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    });
    const organizer = await login(context.app, "organizer1");

    const response = await request(context.app)
      .get("/api/v1/me/events?page=1&pageSize=1")
      .set("Authorization", `Bearer ${organizer}`);
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.total).toBe(2);
    expect(response.body.data[0].organizerId).toBe(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );

    const student = await login(context.app, "student1");
    const forbidden = await request(context.app)
      .get("/api/v1/me/events")
      .set("Authorization", `Bearer ${student}`);
    expect(forbidden.status).toBe(403);
  });

  it("returns student-specific detail fields and hides them from other roles", async () => {
    const context = createContext();
    insertEvent(context.database, { id: eventIds.first });
    const student = await login(context.app, "student1");

    const before = await request(context.app)
      .get(`/api/v1/events/${eventIds.first}`)
      .set("Authorization", `Bearer ${student}`);
    expect(before.body.data.myRegistration).toBeNull();
    expect(before.body.data.myTicket).toBeNull();

    const registration = await request(context.app)
      .post(`/api/v1/events/${eventIds.first}/registrations`)
      .set("Authorization", `Bearer ${student}`)
      .send({});
    expect(registration.status).toBe(201);
    expect(registration.body.data).toMatchObject({
      eventId: eventIds.first,
      userId: "11111111-1111-4111-8111-111111111111",
      status: "REGISTERED",
    });

    const after = await request(context.app)
      .get(`/api/v1/events/${eventIds.first}`)
      .set("Authorization", `Bearer ${student}`);
    expect(after.body.data.myRegistration.id).toBe(registration.body.data.id);

    const organizer = await login(context.app, "organizer1");
    const organizerDetail = await request(context.app)
      .get(`/api/v1/events/${eventIds.first}`)
      .set("Authorization", `Bearer ${organizer}`);
    expect(organizerDetail.body.data.myRegistration).toBeNull();
    expect(organizerDetail.body.data.myTicket).toBeNull();

    const invalid = await request(context.app)
      .get("/api/v1/events/not-a-uuid")
      .set("Authorization", `Bearer ${student}`);
    expect(invalid.status).toBe(400);

    const missing = await request(context.app)
      .get("/api/v1/events/99999999-9999-4999-8999-999999999999")
      .set("Authorization", `Bearer ${student}`);
    expect(missing.status).toBe(404);
  });

  it("rejects duplicate, unauthorized, closed, and non-open registrations", async () => {
    const context = createContext();
    insertEvent(context.database, { id: eventIds.first });
    insertEvent(context.database, {
      id: eventIds.closed,
      registrationDeadline: now.toISOString(),
    });
    insertEvent(context.database, {
      id: eventIds.drawing,
      status: "DRAWING",
    });
    const student = await login(context.app, "student1");
    const organizer = await login(context.app, "organizer1");

    const first = await request(context.app)
      .post(`/api/v1/events/${eventIds.first}/registrations`)
      .set("Authorization", `Bearer ${student}`)
      .send({});
    expect(first.status).toBe(201);

    const duplicate = await request(context.app)
      .post(`/api/v1/events/${eventIds.first}/registrations`)
      .set("Authorization", `Bearer ${student}`)
      .send({});
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("ALREADY_REGISTERED");

    const forbidden = await request(context.app)
      .post(`/api/v1/events/${eventIds.first}/registrations`)
      .set("Authorization", `Bearer ${organizer}`)
      .send({});
    expect(forbidden.status).toBe(403);

    for (const eventId of [eventIds.closed, eventIds.drawing]) {
      const closed = await request(context.app)
        .post(`/api/v1/events/${eventId}/registrations`)
        .set("Authorization", `Bearer ${student}`)
        .send({});
      expect(closed.status).toBe(422);
      expect(closed.body.error.code).toBe("REGISTRATION_CLOSED");
    }
  });

  it("allows only one result from concurrent duplicate registration requests", async () => {
    const context = createContext();
    insertEvent(context.database, { id: eventIds.first });
    const token = await login(context.app, "student1");

    const responses = await Promise.all([
      request(context.app)
        .post(`/api/v1/events/${eventIds.first}/registrations`)
        .set("Authorization", `Bearer ${token}`)
        .send({}),
      request(context.app)
        .post(`/api/v1/events/${eventIds.first}/registrations`)
        .set("Authorization", `Bearer ${token}`)
        .send({}),
    ]);

    expect(responses.map(({ status }) => status).sort()).toEqual([201, 409]);
    expect(context.registrations.countByEvent(eventIds.first)).toBe(1);
  });

  it("enforces the 1000 registration hard limit", async () => {
    const context = createContext();
    insertEvent(context.database, { id: eventIds.full });
    const fill = context.database.transaction(() => {
      const insertUser = context.database.prepare(
        "INSERT INTO users (id, account, display_name, role) VALUES (?, ?, ?, 'STUDENT')",
      );
      const insertRegistration = context.database.prepare(
        `INSERT INTO registrations (id, event_id, user_id, status, created_at)
         VALUES (?, ?, ?, 'REGISTERED', ?)`,
      );
      for (let index = 0; index < 1000; index += 1) {
        const userId = `bulk-user-${index}`;
        insertUser.run(userId, `bulk${index}`, `批量学生${index}`);
        insertRegistration.run(
          `bulk-registration-${index}`,
          eventIds.full,
          userId,
          now.toISOString(),
        );
      }
    });
    fill();
    const student = await login(context.app, "student1");

    const response = await request(context.app)
      .post(`/api/v1/events/${eventIds.full}/registrations`)
      .set("Authorization", `Bearer ${student}`)
      .send({});
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("SOLD_OUT");
    expect(context.registrations.countByEvent(eventIds.full)).toBe(1000);
  });

  it("returns only the student's registrations with complete events", async () => {
    const context = createContext();
    insertEvent(context.database, { id: eventIds.first });
    insertEvent(context.database, { id: eventIds.second });
    context.registrations.insert({
      id: "20000000-0000-4000-8000-000000000001",
      eventId: eventIds.first,
      userId: "11111111-1111-4111-8111-111111111111",
      status: "REGISTERED",
      createdAt: "2026-09-28T01:00:00.000Z",
    });
    context.registrations.insert({
      id: "20000000-0000-4000-8000-000000000002",
      eventId: eventIds.second,
      userId: "11111111-1111-4111-8111-111111111111",
      status: "REGISTERED",
      createdAt: "2026-09-28T02:00:00.000Z",
    });
    const student = await login(context.app, "student1");

    const response = await request(context.app)
      .get("/api/v1/me/registrations?page=1&pageSize=1")
      .set("Authorization", `Bearer ${student}`);
    expect(response.status).toBe(200);
    expect(response.body.total).toBe(2);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toMatchObject({
      id: "20000000-0000-4000-8000-000000000002",
      event: { id: eventIds.second },
    });

    const organizer = await login(context.app, "organizer1");
    const forbidden = await request(context.app)
      .get("/api/v1/me/registrations")
      .set("Authorization", `Bearer ${organizer}`);
    expect(forbidden.status).toBe(403);
  });

  it("does not fabricate chain-derived counts when the ledger is unavailable", async () => {
    const context = createContext();
    insertEvent(context.database, {
      id: eventIds.drawn,
      status: "DRAWN",
      drawWinnersHash: "a".repeat(64),
    });
    const token = await login(context.app, "student1");

    const response = await request(context.app)
      .get(`/api/v1/events/${eventIds.drawn}`)
      .set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("FABRIC_UNAVAILABLE");
  });

  it("uses the ledger reader for confirmed counts and current ticket ownership", async () => {
    const ledger = new FakeLedger();
    const context = createContext(ledger);
    insertEvent(context.database, {
      id: eventIds.drawn,
      status: "DRAWN",
      drawWinnersHash: "a".repeat(64),
    });
    context.database
      .prepare("INSERT INTO draw_winners (event_id, user_id) VALUES (?, ?)")
      .run(eventIds.drawn, "11111111-1111-4111-8111-111111111111");
    ledger.counts.set(eventIds.drawn, { issuedCount: 1, redeemedCount: 0 });
    const ticket: Ticket = {
      id: "b".repeat(64),
      eventId: eventIds.drawn,
      originalWinnerId: "11111111-1111-4111-8111-111111111111",
      ownerId: "11111111-1111-4111-8111-111111111111",
      status: "ACTIVE",
      transferCount: 0,
      claimedAt: "2026-09-29T00:00:00.000Z",
      redeemedAt: null,
    };
    ledger.tickets.set(
      `11111111-1111-4111-8111-111111111111:${eventIds.drawn}`,
      ticket,
    );
    const token = await login(context.app, "student1");

    const response = await request(context.app)
      .get(`/api/v1/events/${eventIds.drawn}`)
      .set("Authorization", `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      winnerCount: 1,
      issuedCount: 1,
      redeemedCount: 0,
      myTicket: ticket,
    });
  });
});
