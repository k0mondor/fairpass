import { createHash } from "node:crypto";

import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import type { AuthConfig } from "../src/config/auth.js";
import { openDatabase, type DatabaseConnection } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";
import {
  DrawRepository,
  type DrawAttemptRecord,
} from "../src/db/repositories/draw-repository.js";
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
import {
  DrawService,
  type SecureRandomIndex,
} from "../src/services/draw-service.js";
import { EventCreationService } from "../src/services/event-creation-service.js";
import { EventService } from "../src/services/event-service.js";
import { GatewayLedgerReadService } from "../src/services/ledger-read-service.js";
import { RegistrationService } from "../src/services/registration-service.js";

const eventId = "60000000-0000-4000-8000-000000000001";
const organizerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const secondOrganizerId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const studentIds = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
] as const;
const registrationDeadline = "2026-09-29T01:00:00.000Z";
const startAt = "2026-10-02T10:00:00.000Z";
const endAt = "2026-10-02T12:00:00.000Z";
const createdAt = "2026-09-28T00:00:00.000Z";

const authConfig: AuthConfig = {
  secret: new TextEncoder().encode("test-secret-with-at-least-32-characters"),
  ttlSeconds: 30 * 24 * 60 * 60,
  issuer: "fairpass-backend",
  audience: "fairpass-demo",
};
const httpConfig = {
  corsOrigins: ["http://127.0.0.1:5173"],
  jsonBodyLimit: "100kb",
};
const silentLog = () => undefined;

interface MutableClock {
  now: Date;
}

interface ContextOptions {
  capacity?: number;
  registrationUserIds?: readonly string[];
  randomIndex?: SecureRandomIndex;
  now?: Date;
}

interface TestContext {
  app: ReturnType<typeof createApp>;
  clock: MutableClock;
  database: DatabaseConnection;
  draws: DrawRepository;
  gateway: MockGatewayAdapter;
}

const databases: DatabaseConnection[] = [];

const hashIds = (ids: readonly string[]): string =>
  createHash("sha256").update(JSON.stringify(ids), "utf8").digest("hex");

const createContext = async (
  options: ContextOptions = {},
): Promise<TestContext> => {
  const clock = {
    now: options.now ?? new Date("2026-09-29T02:00:00.000Z"),
  };
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
  const draws = new DrawRepository(database);
  const idempotency = new IdempotencyRepository(database);
  const registrations = new RegistrationRepository(database);
  const gateway = new MockGatewayAdapter({
    channelName: "test-channel",
    chaincodeName: "fairpass",
    clock: () => new Date(clock.now),
  });

  const capacity = options.capacity ?? 2;
  eventRepository.insert({
    id: eventId,
    organizerId,
    title: "Durable Draw",
    description: "Draw state machine fixture",
    location: "Hall A",
    capacity,
    registrationDeadline,
    startAt,
    endAt,
    createdAt,
  });
  await gateway.submitAndConfirm<ChainEvent>("CreateEvent", [
    eventId,
    organizerId,
    String(capacity),
    startAt,
    endAt,
  ]);

  for (const [index, userId] of (
    options.registrationUserIds ?? studentIds
  ).entries()) {
    registrations.insert({
      id: `70000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      eventId,
      userId,
      status: "REGISTERED",
      createdAt: `2026-09-28T0${index + 1}:00:00.000Z`,
    });
  }

  const auth = new AuthService(
    users,
    new DemoTokenService(
      authConfig,
      () => Math.floor(clock.now.getTime() / 1000),
    ),
  );
  const ledger = new GatewayLedgerReadService(gateway);
  const events = new EventService(
    eventRepository,
    registrations,
    ledger,
    () => new Date(clock.now),
  );
  const eventCreation = new EventCreationService(
    database,
    eventRepository,
    idempotency,
    gateway,
    events,
    () => new Date(clock.now),
  );
  const registrationService = new RegistrationService(
    database,
    registrations,
    events,
    () => new Date(clock.now),
  );
  const drawService = new DrawService(
    database,
    eventRepository,
    draws,
    gateway,
    () => new Date(clock.now),
    options.randomIndex ?? (() => 0),
  );
  const apiRouter = createApiRouter({
    auth,
    draws: drawService,
    eventCreation,
    events,
    registrations: registrationService,
  });

  return {
    app: createApp({ config: httpConfig, apiRouter, logSink: silentLog }),
    clock,
    database,
    draws,
    gateway,
  };
};

const login = async (context: TestContext, account: string): Promise<string> => {
  const response = await request(context.app)
    .post("/api/v1/auth/demo-login")
    .send({ account });
  expect(response.status).toBe(200);
  return response.body.data.token as string;
};

const publishRequest = (context: TestContext, token: string) =>
  request(context.app)
    .post(`/api/v1/events/${eventId}/draw`)
    .set("Authorization", `Bearer ${token}`)
    .send({});

const getRequest = (context: TestContext, token: string) =>
  request(context.app)
    .get(`/api/v1/events/${eventId}/draw`)
    .set("Authorization", `Bearer ${token}`);

const drawOperations = (context: TestContext) =>
  context.gateway
    .snapshot()
    .operations.filter(({ type }) => type === "DRAW_PUBLISHED");

afterEach(() => {
  for (const database of databases.splice(0)) {
    if (database.open) database.close();
  }
});

describe("durable draw HTTP flow", () => {
  it("enforces organizer role and event ownership while hiding unconfirmed data", async () => {
    const context = await createContext();
    const organizer = await login(context, "organizer1");
    const otherOrganizer = await login(context, "organizer2");
    const student = await login(context, "student1");

    const open = await getRequest(context, organizer);
    expect(open.status).toBe(200);
    expect(open.body.data).toEqual({
      status: "OPEN",
      registrationCount: 3,
      winnerCount: 0,
      winnersHash: null,
      winners: [],
    });

    expect((await getRequest(context, student)).status).toBe(403);
    expect((await getRequest(context, otherOrganizer)).status).toBe(403);
    expect((await publishRequest(context, otherOrganizer)).status).toBe(403);
    expect(drawOperations(context)).toHaveLength(0);
  });

  it("allows the deadline boundary, persists canonical winners, and exposes only confirmed results", async () => {
    const context = await createContext({
      now: new Date("2026-09-29T00:59:59.999Z"),
    });
    const organizer = await login(context, "organizer1");

    const early = await publishRequest(context, organizer);
    expect(early.status).toBe(422);
    expect(early.body.error.code).toBe("DRAW_NOT_READY");

    context.clock.now = new Date(registrationDeadline);
    const published = await publishRequest(context, organizer);
    expect(published.status).toBe(200);
    expect(published.body.data).toMatchObject({
      eventId,
      winnerCount: 2,
      winnersHash: hashIds([studentIds[1], studentIds[2]]),
      txId: expect.stringMatching(/^mock-/),
    });

    const attempt = context.draws.findAttempt(eventId);
    expect(attempt).toMatchObject({
      winnerIdsJson: JSON.stringify([studentIds[1], studentIds[2]]),
      winnersHash: published.body.data.winnersHash,
      state: "CONFIRMED",
      txId: published.body.data.txId,
    });
    const statuses = context.database
      .prepare(
        `SELECT user_id, status FROM registrations
         WHERE event_id = ? ORDER BY user_id`,
      )
      .all(eventId);
    expect(statuses).toEqual([
      { user_id: studentIds[0], status: "LOST" },
      { user_id: studentIds[1], status: "WON" },
      { user_id: studentIds[2], status: "WON" },
    ]);

    const visible = await getRequest(context, organizer);
    expect(visible.status).toBe(200);
    expect(visible.body.data).toMatchObject({
      status: "DRAWN",
      registrationCount: 3,
      winnerCount: 2,
      winnersHash: published.body.data.winnersHash,
      winners: [
        { id: studentIds[1], role: "STUDENT" },
        { id: studentIds[2], role: "STUDENT" },
      ],
    });

    const repeated = await publishRequest(context, organizer);
    expect(repeated.status).toBe(409);
    expect(repeated.body.error.code).toBe("ALREADY_DRAWN");
  });

  it("rejects the exact activity start boundary", async () => {
    const context = await createContext({ now: new Date(startAt) });
    const organizer = await login(context, "organizer1");

    const response = await publishRequest(context, organizer);
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("DRAW_NOT_READY");
    expect(context.draws.findAttempt(eventId)).toBeNull();
  });

  it("publishes an empty draw with the canonical empty-array hash", async () => {
    const context = await createContext({ registrationUserIds: [] });
    const organizer = await login(context, "organizer1");

    const response = await publishRequest(context, organizer);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      winnerCount: 0,
      winnersHash: hashIds([]),
    });
    expect(context.draws.listConfirmedWinners(eventId)).toEqual([]);
  });

  it("selects every registrant when capacity exceeds registration count", async () => {
    const context = await createContext({
      capacity: 3,
      registrationUserIds: [studentIds[0]],
    });
    const organizer = await login(context, "organizer1");

    const response = await publishRequest(context, organizer);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      winnerCount: 1,
      winnersHash: hashIds([studentIds[0]]),
    });
  });

  it("publishes at most one winner snapshot under concurrent requests", async () => {
    const context = await createContext();
    const organizer = await login(context, "organizer1");

    const responses = await Promise.all([
      publishRequest(context, organizer),
      publishRequest(context, organizer),
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
    const conflict = responses.find(({ status }) => status === 409)!;
    expect(["DRAW_IN_PROGRESS", "ALREADY_DRAWN"]).toContain(
      conflict.body.error.code,
    );
    expect(context.database.prepare(
      "SELECT COUNT(*) AS count FROM draw_attempts WHERE event_id = ?",
    ).get(eventId)).toEqual({ count: 1 });
    expect(drawOperations(context)).toHaveLength(1);
  });

  it("reconciles commit-unknown without publishing a second transaction", async () => {
    const context = await createContext();
    context.gateway.queueFault("PublishDraw", { kind: "COMMIT_UNKNOWN" });
    const organizer = await login(context, "organizer1");

    const response = await publishRequest(context, organizer);
    expect(response.status).toBe(200);
    expect(response.body.data.txId).toMatch(/^mock-/);
    expect(context.draws.findAttempt(eventId)).toMatchObject({
      state: "CONFIRMED",
      txId: response.body.data.txId,
    });
    expect(drawOperations(context)).toHaveLength(1);
  });

  it("keeps the persisted snapshot through an unknown result and finishes on retry", async () => {
    let randomCalls = 0;
    const context = await createContext({
      randomIndex: () => {
        randomCalls += 1;
        return 0;
      },
    });
    context.gateway.queueFault("PublishDraw", { kind: "COMMIT_UNKNOWN" });
    context.gateway.queueFault("GetEvent", { kind: "NETWORK" });
    const organizer = await login(context, "organizer1");

    const unknown = await publishRequest(context, organizer);
    expect(unknown.status).toBe(503);
    expect(unknown.body.error.code).toBe("FABRIC_UNAVAILABLE");
    const pending = context.draws.findAttempt(eventId);
    expect(pending).toMatchObject({
      winnerIdsJson: JSON.stringify([studentIds[1], studentIds[2]]),
      state: "PENDING",
      txId: expect.stringMatching(/^mock-/),
    });

    const hidden = await getRequest(context, organizer);
    expect(hidden.body.data).toMatchObject({
      status: "DRAWING",
      winnerCount: 0,
      winnersHash: null,
      winners: [],
    });

    const recovered = await publishRequest(context, organizer);
    expect(recovered.status).toBe(200);
    expect(recovered.body.data.winnersHash).toBe(pending!.winnersHash);
    expect(randomCalls).toBe(2);
    expect(drawOperations(context)).toHaveLength(1);
    expect(context.draws.findAttempt(eventId)?.state).toBe("CONFIRMED");
  });

  it("stops recovery and records a conflict when the chain hash differs", async () => {
    const context = await createContext({ registrationUserIds: [] });
    const timestamp = context.clock.now.toISOString();
    const localAttempt: DrawAttemptRecord = {
      eventId,
      winnerIdsJson: "[]",
      winnersHash: hashIds([]),
      state: "PENDING",
      txId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const reserve = context.database.transaction(() => {
      context.draws.insertAttempt(localAttempt);
      expect(context.draws.setEventDrawing(eventId)).toBe(true);
    });
    reserve.immediate();
    await context.gateway.submitAndConfirm<ChainEvent>("PublishDraw", [
      eventId,
      JSON.stringify([studentIds[0]]),
      hashIds([studentIds[0]]),
    ]);
    const organizer = await login(context, "organizer1");

    const response = await publishRequest(context, organizer);
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("FABRIC_UNAVAILABLE");
    expect(context.draws.findAttempt(eventId)?.state).toBe("CONFLICT");
    expect(drawOperations(context)).toHaveLength(1);
  });
});
