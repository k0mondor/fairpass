import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import type { AuthConfig } from "../src/config/auth.js";
import { openDatabase, type DatabaseConnection } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";
import { DrawRepository } from "../src/db/repositories/draw-repository.js";
import { EventRepository } from "../src/db/repositories/event-repository.js";
import { IdempotencyRepository } from "../src/db/repositories/idempotency-repository.js";
import { RegistrationRepository } from "../src/db/repositories/registration-repository.js";
import { UserRepository } from "../src/db/repositories/user-repository.js";
import { seedDemoUsers } from "../src/db/seed.js";
import { MockGatewayAdapter } from "../src/fabric/mock-gateway-adapter.js";
import type { ChainEvent } from "../src/fabric/types.js";
import { createApiRouter } from "../src/routes/index.js";
import { AuthService } from "../src/services/auth-service.js";
import { DemoTokenService } from "../src/services/demo-token-service.js";
import { DrawService } from "../src/services/draw-service.js";
import {
  EventCreationService,
  prepareCreateEvent,
  type CreateEventInput,
} from "../src/services/event-creation-service.js";
import { EventService } from "../src/services/event-service.js";
import { GatewayLedgerReadService } from "../src/services/ledger-read-service.js";
import { OperationService } from "../src/services/operation-service.js";
import { RegistrationService } from "../src/services/registration-service.js";
import { TicketService } from "../src/services/ticket-service.js";

const now = new Date("2026-09-29T00:00:00.000Z");
const organizerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const secondOrganizerId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const eventId = "50000000-0000-4000-8000-000000000001";
const idempotencyKeys = {
  primary: "90000000-0000-4000-8000-000000000001",
  network: "90000000-0000-4000-8000-000000000002",
  unknown: "90000000-0000-4000-8000-000000000003",
  recovery: "90000000-0000-4000-8000-000000000004",
  mismatch: "90000000-0000-4000-8000-000000000005",
  invalid: "90000000-0000-4000-8000-000000000006",
} as const;

const authConfig: AuthConfig = {
  secret: new TextEncoder().encode("test-secret-with-at-least-32-characters"),
  ttlSeconds: 3600,
  issuer: "fairpass-backend",
  audience: "fairpass-demo",
};
const httpConfig = {
  corsOrigins: ["http://127.0.0.1:5173"],
  jsonBodyLimit: "100kb",
};
const silentLog = () => undefined;
const createInput: CreateEventInput = {
  title: "Campus Design Night",
  description: "An evening of student projects.",
  location: "Hall A",
  capacity: 2,
  registrationDeadline: "2026-10-01T10:00:00Z",
  startAt: "2026-10-02T10:00:00Z",
  endAt: "2026-10-02T12:00:00Z",
};

interface TestContext {
  app: ReturnType<typeof createApp>;
  database: DatabaseConnection;
  gateway: MockGatewayAdapter;
  idempotency: IdempotencyRepository;
  issuedEventIds: string[];
}

const databases: DatabaseConnection[] = [];

const createContext = (): TestContext => {
  const database = openDatabase(":memory:");
  databases.push(database);
  runMigrations(database);
  seedDemoUsers(database);
  database
    .prepare(
      "INSERT INTO users (id, account, display_name, role) VALUES (?, ?, ?, ?)",
    )
    .run(secondOrganizerId, "organizer2", "主办方二", "ORGANIZER");

  const users = new UserRepository(database);
  const eventRepository = new EventRepository(database);
  const drawRepository = new DrawRepository(database);
  const idempotency = new IdempotencyRepository(database);
  const registrationRepository = new RegistrationRepository(database);
  const auth = new AuthService(
    users,
    new DemoTokenService(authConfig, () => Math.floor(now.getTime() / 1000)),
  );
  const gateway = new MockGatewayAdapter({
    channelName: "test-channel",
    chaincodeName: "fairpass",
    clock: () => new Date(now),
  });
  const ledger = new GatewayLedgerReadService(gateway);
  const events = new EventService(
    eventRepository,
    registrationRepository,
    ledger,
    () => new Date(now),
  );
  const issuedEventIds: string[] = [];
  const eventCreation = new EventCreationService(
    database,
    eventRepository,
    idempotency,
    gateway,
    events,
    () => new Date(now),
    () => {
      const next =
        issuedEventIds.length === 0
          ? eventId
          : `50000000-0000-4000-8000-${String(issuedEventIds.length + 1).padStart(12, "0")}`;
      issuedEventIds.push(next);
      return next;
    },
  );
  const registrations = new RegistrationService(
    database,
    registrationRepository,
    events,
    () => new Date(now),
  );
  const draws = new DrawService(
    database,
    eventRepository,
    drawRepository,
    gateway,
    () => new Date(now),
    () => 0,
  );
  const tickets = new TicketService(
    drawRepository,
    users,
    gateway,
    events,
    () => new Date(now),
  );
  const operations = new OperationService(gateway, events, tickets);
  const apiRouter = createApiRouter({
    auth,
    draws,
    eventCreation,
    events,
    operations,
    registrations,
    tickets,
  });

  return {
    app: createApp({ config: httpConfig, apiRouter, logSink: silentLog }),
    database,
    gateway,
    idempotency,
    issuedEventIds,
  };
};

const login = async (context: TestContext, account: string) => {
  const response = await request(context.app)
    .post("/api/v1/auth/demo-login")
    .send({ account });
  expect(response.status).toBe(200);
  return response.body.data.token as string;
};

const createRequest = (
  context: TestContext,
  token: string,
  key: string,
  input: CreateEventInput = createInput,
) =>
  request(context.app)
    .post("/api/v1/events")
    .set("Authorization", `Bearer ${token}`)
    .set("Idempotency-Key", key)
    .send(input);

const countRows = (database: DatabaseConnection, table: string): number => {
  const allowed = new Set(["events", "idempotency_keys"]);
  if (!allowed.has(table)) throw new Error("Unexpected table");
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
    count: number;
  };
  return row.count;
};

afterEach(() => {
  for (const database of databases.splice(0)) {
    if (database.open) database.close();
  }
});

describe("POST /api/v1/events", () => {
  it("creates an event only after a confirmed Gateway commit", async () => {
    const context = createContext();
    const token = await login(context, "organizer1");

    const response = await createRequest(
      context,
      token,
      idempotencyKeys.primary,
    );

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      id: eventId,
      organizerId,
      title: createInput.title,
      capacity: createInput.capacity,
      registrationDeadline: "2026-10-01T10:00:00.000Z",
      startAt: "2026-10-02T10:00:00.000Z",
      endAt: "2026-10-02T12:00:00.000Z",
      status: "OPEN",
      registrationCount: 0,
      winnerCount: 0,
      issuedCount: 0,
      redeemedCount: 0,
      createdAt: now.toISOString(),
    });
    expect(context.gateway.snapshot()).toMatchObject({
      events: [{ eventId, organizerId, capacity: 2 }],
      operations: [{ eventId, type: "EVENT_CREATED" }],
    });
    expect(context.idempotency.findByKey(idempotencyKeys.primary)).toMatchObject({
      eventId,
      actorId: organizerId,
      state: "CONFIRMED",
      txId: expect.stringMatching(/^mock-/),
    });
    expect(countRows(context.database, "events")).toBe(1);
  });

  it("requires an organizer, a UUID idempotency key, and a future deadline", async () => {
    const context = createContext();
    const organizer = await login(context, "organizer1");
    const student = await login(context, "student1");

    const forbidden = await createRequest(
      context,
      student,
      idempotencyKeys.invalid,
    );
    expect(forbidden.status).toBe(403);

    const missingKey = await request(context.app)
      .post("/api/v1/events")
      .set("Authorization", `Bearer ${organizer}`)
      .send(createInput);
    expect(missingKey.status).toBe(400);
    expect(missingKey.body.error.code).toBe("VALIDATION_ERROR");

    const pastDeadline = await createRequest(
      context,
      organizer,
      idempotencyKeys.invalid,
      {
        ...createInput,
        registrationDeadline: now.toISOString(),
      },
    );
    expect(pastDeadline.status).toBe(422);
    expect(pastDeadline.body.error.code).toBe("REGISTRATION_CLOSED");
    expect(countRows(context.database, "events")).toBe(0);
    expect(countRows(context.database, "idempotency_keys")).toBe(0);
  });

  it("replays the same intent with 200 and rejects key reuse", async () => {
    const context = createContext();
    const organizer = await login(context, "organizer1");
    const otherOrganizer = await login(context, "organizer2");

    const first = await createRequest(
      context,
      organizer,
      idempotencyKeys.primary,
    );
    const replay = await createRequest(
      context,
      organizer,
      idempotencyKeys.primary,
    );
    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.body.data).toEqual(first.body.data);

    const changedPayload = await createRequest(
      context,
      organizer,
      idempotencyKeys.primary,
      { ...createInput, title: "Different event" },
    );
    expect(changedPayload.status).toBe(409);
    expect(changedPayload.body.error.code).toBe("IDEMPOTENCY_CONFLICT");

    const changedActor = await createRequest(
      context,
      otherOrganizer,
      idempotencyKeys.primary,
    );
    expect(changedActor.status).toBe(409);
    expect(context.issuedEventIds).toEqual([eventId]);
    expect(context.gateway.snapshot().operations).toHaveLength(1);
    expect(countRows(context.database, "events")).toBe(1);
  });

  it("coalesces concurrent requests into one event and one transaction", async () => {
    const context = createContext();
    const token = await login(context, "organizer1");

    const responses = await Promise.all([
      createRequest(context, token, idempotencyKeys.primary),
      createRequest(context, token, idempotencyKeys.primary),
    ]);

    expect(responses.map(({ status }) => status).sort()).toEqual([200, 201]);
    expect(responses[0].body.data.id).toBe(eventId);
    expect(responses[1].body.data.id).toBe(eventId);
    expect(context.issuedEventIds).toEqual([eventId]);
    expect(context.gateway.snapshot().operations).toHaveLength(1);
    expect(countRows(context.database, "events")).toBe(1);
  });

  it("retries once with the same event ID after a confirmed pre-submit failure", async () => {
    const context = createContext();
    context.gateway.queueFault("CreateEvent", { kind: "NETWORK" });
    const token = await login(context, "organizer1");

    const response = await createRequest(
      context,
      token,
      idempotencyKeys.network,
    );

    expect(response.status).toBe(201);
    expect(response.body.data.id).toBe(eventId);
    expect(context.issuedEventIds).toEqual([eventId]);
    expect(context.gateway.snapshot().events).toHaveLength(1);
    expect(context.gateway.snapshot().operations).toHaveLength(1);
  });

  it("reconciles commit-unknown without submitting a second transaction", async () => {
    const context = createContext();
    context.gateway.queueFault("CreateEvent", { kind: "COMMIT_UNKNOWN" });
    const token = await login(context, "organizer1");

    const response = await createRequest(
      context,
      token,
      idempotencyKeys.unknown,
    );

    expect(response.status).toBe(201);
    expect(response.body.data.id).toBe(eventId);
    const snapshot = context.gateway.snapshot();
    expect(snapshot.events).toHaveLength(1);
    expect(snapshot.operations).toHaveLength(1);
    expect(context.idempotency.findByKey(idempotencyKeys.unknown)).toMatchObject({
      eventId,
      state: "CONFIRMED",
      txId: snapshot.operations[0]!.txId,
    });
  });

  it("returns 503 while reconciliation is unknown, then safely finishes on retry", async () => {
    const context = createContext();
    context.gateway.queueFault("CreateEvent", { kind: "COMMIT_UNKNOWN" });
    context.gateway.queueFault("GetEvent", { kind: "NETWORK" });
    const token = await login(context, "organizer1");

    const unknown = await createRequest(
      context,
      token,
      idempotencyKeys.unknown,
    );
    expect(unknown.status).toBe(503);
    expect(unknown.body.error.code).toBe("FABRIC_UNAVAILABLE");
    expect(countRows(context.database, "events")).toBe(0);
    expect(context.idempotency.findByKey(idempotencyKeys.unknown)).toMatchObject({
      eventId,
      state: "PENDING",
      txId: expect.stringMatching(/^mock-/),
    });

    const recovered = await createRequest(
      context,
      token,
      idempotencyKeys.unknown,
    );
    expect(recovered.status).toBe(200);
    expect(recovered.body.data.id).toBe(eventId);
    expect(context.gateway.snapshot().events).toHaveLength(1);
    expect(context.gateway.snapshot().operations).toHaveLength(1);
    expect(countRows(context.database, "events")).toBe(1);
  });

  it("finishes a pending local record when the chain event already exists", async () => {
    const context = createContext();
    const prepared = prepareCreateEvent(createInput);
    context.idempotency.insert({
      key: idempotencyKeys.recovery,
      actorId: organizerId,
      requestHash: prepared.requestHash,
      eventId,
      state: "PENDING",
      txId: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    await context.gateway.submitAndConfirm<ChainEvent>("CreateEvent", [
      eventId,
      organizerId,
      String(prepared.input.capacity),
      prepared.input.startAt,
      prepared.input.endAt,
    ]);
    const token = await login(context, "organizer1");

    const recovered = await createRequest(
      context,
      token,
      idempotencyKeys.recovery,
    );

    expect(recovered.status).toBe(200);
    expect(recovered.body.data.id).toBe(eventId);
    expect(context.gateway.snapshot().operations).toHaveLength(1);
    expect(context.idempotency.findByKey(idempotencyKeys.recovery)).toMatchObject({
      state: "CONFIRMED",
      txId: expect.stringMatching(/^mock-/),
    });
    expect(countRows(context.database, "events")).toBe(1);
  });

  it("stops recovery when the fixed event ID has different chain fields", async () => {
    const context = createContext();
    const prepared = prepareCreateEvent(createInput);
    context.idempotency.insert({
      key: idempotencyKeys.mismatch,
      actorId: organizerId,
      requestHash: prepared.requestHash,
      eventId,
      state: "PENDING",
      txId: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    await context.gateway.submitAndConfirm<ChainEvent>("CreateEvent", [
      eventId,
      organizerId,
      "99",
      prepared.input.startAt,
      prepared.input.endAt,
    ]);
    const token = await login(context, "organizer1");

    const response = await createRequest(
      context,
      token,
      idempotencyKeys.mismatch,
    );

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(countRows(context.database, "events")).toBe(0);
    expect(context.idempotency.findByKey(idempotencyKeys.mismatch)?.state).toBe(
      "FAILED",
    );
  });
});
