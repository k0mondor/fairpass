import { createHash } from "node:crypto";

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
import { EventCreationService } from "../src/services/event-creation-service.js";
import { EventService } from "../src/services/event-service.js";
import { GatewayLedgerReadService } from "../src/services/ledger-read-service.js";
import { RegistrationService } from "../src/services/registration-service.js";
import { TicketService } from "../src/services/ticket-service.js";
import type { Ticket } from "../src/types/domain.js";

const eventId = "80000000-0000-4000-8000-000000000001";
const missingEventId = "80000000-0000-4000-8000-000000000099";
const organizerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const secondOrganizerId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const inspectorId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const studentIds = {
  loser: "11111111-1111-4111-8111-111111111111",
  winner: "22222222-2222-4222-8222-222222222222",
  otherWinner: "33333333-3333-4333-8333-333333333333",
} as const;
const registrationDeadline = "2026-09-29T01:00:00.000Z";
const startAt = "2026-10-02T10:00:00.000Z";
const endAt = "2026-10-02T12:00:00.000Z";
const initialNow = new Date("2026-09-29T02:00:00.000Z");

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

interface TestContext {
  app: ReturnType<typeof createApp>;
  clock: { now: Date };
  database: DatabaseConnection;
  gateway: MockGatewayAdapter;
}

const databases: DatabaseConnection[] = [];

const ticketIdFor = (winnerId: string) =>
  createHash("sha256")
    .update(`ticket:${eventId}:${winnerId}`, "utf8")
    .digest("hex");

const createContext = async (): Promise<TestContext> => {
  const clock = { now: new Date(initialNow) };
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
  const registrations = new RegistrationRepository(database);
  const gateway = new MockGatewayAdapter({
    channelName: "test-channel",
    chaincodeName: "fairpass",
    clock: () => new Date(clock.now),
  });

  eventRepository.insert({
    id: eventId,
    organizerId,
    title: "Ticket Query Fixture",
    description: "G1 and G2 acceptance fixture",
    location: "Hall B",
    capacity: 2,
    registrationDeadline,
    startAt,
    endAt,
    createdAt: "2026-09-28T00:00:00.000Z",
  });
  await gateway.submitAndConfirm<ChainEvent>("CreateEvent", [
    eventId,
    organizerId,
    "2",
    startAt,
    endAt,
  ]);

  for (const [index, userId] of Object.values(studentIds).entries()) {
    registrations.insert({
      id: `81000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
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
  const draws = new DrawService(
    database,
    eventRepository,
    drawRepository,
    gateway,
    () => new Date(clock.now),
    () => 0,
  );
  await draws.publish(eventId, organizerId);
  const tickets = new TicketService(
    drawRepository,
    users,
    gateway,
    events,
    () => new Date(clock.now),
  );
  const apiRouter = createApiRouter({
    auth,
    draws,
    eventCreation,
    events,
    registrations: registrationService,
    tickets,
  });

  return {
    app: createApp({ config: httpConfig, apiRouter, logSink: silentLog }),
    clock,
    database,
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

const claim = (context: TestContext, token: string) =>
  request(context.app)
    .post(`/api/v1/events/${eventId}/tickets/claim`)
    .set("Authorization", `Bearer ${token}`)
    .send({});

const listTickets = (context: TestContext, token: string, query = "") =>
  request(context.app)
    .get(`/api/v1/me/tickets${query}`)
    .set("Authorization", `Bearer ${token}`);

const getTicket = (context: TestContext, token: string, ticketId: string) =>
  request(context.app)
    .get(`/api/v1/tickets/${ticketId}`)
    .set("Authorization", `Bearer ${token}`);

const transfer = (
  context: TestContext,
  token: string,
  ticketId: string,
  toUserId: string,
) =>
  request(context.app)
    .post(`/api/v1/tickets/${ticketId}/transfer`)
    .set("Authorization", `Bearer ${token}`)
    .send({ toUserId });

const redeem = (context: TestContext, token: string, ticketId: string) =>
  request(context.app)
    .post(`/api/v1/tickets/${ticketId}/redeem`)
    .set("Authorization", `Bearer ${token}`)
    .send({});

const ticketOperations = (context: TestContext) =>
  context.gateway
    .snapshot()
    .operations.filter(({ type }) => type === "TICKET_CLAIMED");

afterEach(() => {
  for (const database of databases.splice(0)) {
    if (database.open) database.close();
  }
});

describe("G1 ticket claim", () => {
  it("claims only for a confirmed winner and rejects duplicate and wrong-role requests", async () => {
    const context = await createContext();
    const winner = await login(context, "student2");
    const loser = await login(context, "student1");
    const organizer = await login(context, "organizer1");

    expect((await claim(context, organizer)).status).toBe(403);

    const rejected = await claim(context, loser);
    expect(rejected.status).toBe(409);
    expect(rejected.body.error.code).toBe("NOT_WINNER");

    const response = await claim(context, winner);
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      id: ticketIdFor(studentIds.winner),
      eventId,
      originalWinnerId: studentIds.winner,
      ownerId: studentIds.winner,
      status: "ACTIVE",
      transferCount: 0,
      redeemedAt: null,
    });
    expect(ticketOperations(context)).toHaveLength(1);
    expect(
      (await context.gateway.evaluate<ChainEvent>("GetEvent", [eventId]))
        .issuedCount,
    ).toBe(1);

    const duplicate = await claim(context, winner);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("ALREADY_CLAIMED");
    expect(ticketOperations(context)).toHaveLength(1);
  });

  it("rejects claims at the exact start boundary and unknown events", async () => {
    const context = await createContext();
    context.clock.now = new Date(startAt);
    const winner = await login(context, "student3");

    const closed = await claim(context, winner);
    expect(closed.status).toBe(422);
    expect(closed.body.error.code).toBe("CLAIM_CLOSED");

    const missing = await request(context.app)
      .post(`/api/v1/events/${missingEventId}/tickets/claim`)
      .set("Authorization", `Bearer ${winner}`)
      .send({});
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("NOT_FOUND");
  });

  it("reconciles commit-unknown and retries a confirmed pre-submit failure safely", async () => {
    const unknownContext = await createContext();
    unknownContext.gateway.queueFault("ClaimTicket", { kind: "COMMIT_UNKNOWN" });
    const winner = await login(unknownContext, "student2");

    const reconciled = await claim(unknownContext, winner);
    expect(reconciled.status).toBe(201);
    expect(reconciled.body.data.id).toBe(ticketIdFor(studentIds.winner));
    expect(ticketOperations(unknownContext)).toHaveLength(1);

    const retryContext = await createContext();
    retryContext.gateway.queueFault("ClaimTicket", { kind: "NETWORK" });
    const otherWinner = await login(retryContext, "student3");
    const retried = await claim(retryContext, otherWinner);
    expect(retried.status).toBe(201);
    expect(retried.body.data.id).toBe(ticketIdFor(studentIds.otherWinner));
    expect(ticketOperations(retryContext)).toHaveLength(1);
  });
});

describe("G2 ticket queries", () => {
  it("paginates the current owner's tickets and attaches complete events", async () => {
    const context = await createContext();
    const firstWinner = await login(context, "student2");
    const secondWinner = await login(context, "student3");
    await claim(context, firstWinner);
    context.clock.now = new Date("2026-09-29T03:00:00.000Z");
    await claim(context, secondWinner);

    const firstPage = await listTickets(context, secondWinner, "?page=1&pageSize=1");
    expect(firstPage.status).toBe(200);
    expect(firstPage.body).toMatchObject({ page: 1, pageSize: 1, total: 1 });
    expect(firstPage.body.data[0]).toMatchObject({
      id: ticketIdFor(studentIds.otherWinner),
      ownerId: studentIds.otherWinner,
      event: {
        id: eventId,
        status: "DRAWN",
        registrationCount: 3,
        winnerCount: 2,
        issuedCount: 2,
        redeemedCount: 0,
      },
    });

    const emptyPage = await listTickets(context, secondWinner, "?page=2&pageSize=1");
    expect(emptyPage.body).toMatchObject({ page: 2, pageSize: 1, total: 1 });
    expect(emptyPage.body.data).toEqual([]);

    const organizer = await login(context, "organizer1");
    expect((await listTickets(context, organizer)).status).toBe(403);
    expect((await listTickets(context, secondWinner, "?page=0")).status).toBe(400);
  });

  it("allows only the current owner, event organizer, and inspectors to read details", async () => {
    const context = await createContext();
    const owner = await login(context, "student2");
    const otherStudent = await login(context, "student1");
    const organizer = await login(context, "organizer1");
    const otherOrganizer = await login(context, "organizer2");
    const inspector = await login(context, "inspector1");
    const claimed = await claim(context, owner);
    const ticketId = claimed.body.data.id as string;

    for (const allowed of [owner, organizer, inspector]) {
      const response = await getTicket(context, allowed, ticketId);
      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({
        id: ticketId,
        ownerId: studentIds.winner,
        event: { id: eventId, organizerId },
      });
    }
    expect((await getTicket(context, otherStudent, ticketId)).status).toBe(403);
    expect((await getTicket(context, otherOrganizer, ticketId)).status).toBe(403);
    expect((await getTicket(context, owner, "not-a-ticket")).status).toBe(400);
    expect((await getTicket(context, owner, "f".repeat(64))).status).toBe(404);
  });

  it("reads ownership from the Gateway index after a transfer", async () => {
    const context = await createContext();
    const originalOwner = await login(context, "student2");
    const recipient = await login(context, "student1");
    const claimed = await claim(context, originalOwner);
    const ticketId = claimed.body.data.id as string;

    await context.gateway.submitAndConfirm<Ticket>("TransferTicket", [
      ticketId,
      studentIds.winner,
      studentIds.loser,
    ]);

    const originalList = await listTickets(context, originalOwner);
    expect(originalList.body).toMatchObject({ data: [], total: 0 });
    expect((await getTicket(context, originalOwner, ticketId)).status).toBe(403);

    const recipientList = await listTickets(context, recipient);
    expect(recipientList.body.total).toBe(1);
    expect(recipientList.body.data[0]).toMatchObject({
      id: ticketId,
      ownerId: studentIds.loser,
      originalWinnerId: studentIds.winner,
      transferCount: 1,
    });
    expect((await getTicket(context, recipient, ticketId)).status).toBe(200);
  });

  it("returns 503 instead of stale local data when the owner index is unavailable", async () => {
    const context = await createContext();
    context.gateway.queueFault("GetTicketsByOwner", { kind: "NETWORK" });
    const student = await login(context, "student2");

    const response = await listTickets(context, student);
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("FABRIC_UNAVAILABLE");
  });
});

describe("G3 ticket transfer", () => {
  it("transfers to another student and immediately updates owner visibility", async () => {
    const context = await createContext();
    const owner = await login(context, "student2");
    const recipient = await login(context, "student1");
    const claimed = await claim(context, owner);
    const ticketId = claimed.body.data.id as string;

    const response = await transfer(
      context,
      owner,
      ticketId,
      studentIds.loser,
    );
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: ticketId,
      eventId,
      originalWinnerId: studentIds.winner,
      ownerId: studentIds.loser,
      status: "ACTIVE",
      transferCount: 1,
      redeemedAt: null,
    });

    const operations = context.gateway
      .snapshot()
      .operations.filter(({ type }) => type === "TICKET_TRANSFERRED");
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      ticketId,
      actorId: studentIds.winner,
      fromUserId: studentIds.winner,
      toUserId: studentIds.loser,
    });
    expect(await listTickets(context, owner)).toMatchObject({
      body: { data: [], total: 0 },
    });
    expect((await getTicket(context, owner, ticketId)).status).toBe(403);

    const recipientList = await listTickets(context, recipient);
    expect(recipientList.body.total).toBe(1);
    expect(recipientList.body.data[0]).toMatchObject({
      id: ticketId,
      ownerId: studentIds.loser,
      transferCount: 1,
    });
    expect((await getTicket(context, recipient, ticketId)).status).toBe(200);
  });

  it("rejects wrong roles, non-owners, self, non-students, and unknown recipients", async () => {
    const context = await createContext();
    const owner = await login(context, "student2");
    const otherStudent = await login(context, "student1");
    const organizer = await login(context, "organizer1");
    const claimed = await claim(context, owner);
    const ticketId = claimed.body.data.id as string;

    expect(
      (await transfer(context, organizer, ticketId, studentIds.loser)).status,
    ).toBe(403);

    const nonOwner = await transfer(
      context,
      otherStudent,
      ticketId,
      studentIds.otherWinner,
    );
    expect(nonOwner.status).toBe(403);
    expect(nonOwner.body.error.code).toBe("NOT_TICKET_OWNER");

    for (const invalidRecipient of [
      studentIds.winner,
      organizerId,
      "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    ]) {
      const rejected = await transfer(
        context,
        owner,
        ticketId,
        invalidRecipient,
      );
      expect(rejected.status).toBe(409);
      expect(rejected.body.error.code).toBe("INVALID_RECIPIENT");
    }

    expect((await transfer(context, owner, ticketId, "bad-id")).status).toBe(400);
  });

  it("rejects a second transfer and transfers at the exact start boundary", async () => {
    const transferredContext = await createContext();
    const owner = await login(transferredContext, "student2");
    const recipient = await login(transferredContext, "student1");
    const claimed = await claim(transferredContext, owner);
    const ticketId = claimed.body.data.id as string;
    expect(
      (
        await transfer(
          transferredContext,
          owner,
          ticketId,
          studentIds.loser,
        )
      ).status,
    ).toBe(200);

    const secondTransfer = await transfer(
      transferredContext,
      recipient,
      ticketId,
      studentIds.otherWinner,
    );
    expect(secondTransfer.status).toBe(409);
    expect(secondTransfer.body.error.code).toBe("TRANSFER_LIMIT_REACHED");

    const closedContext = await createContext();
    const boundaryOwner = await login(closedContext, "student2");
    const boundaryClaim = await claim(closedContext, boundaryOwner);
    closedContext.clock.now = new Date(startAt);
    const closed = await transfer(
      closedContext,
      boundaryOwner,
      boundaryClaim.body.data.id as string,
      studentIds.loser,
    );
    expect(closed.status).toBe(422);
    expect(closed.body.error.code).toBe("TRANSFER_CLOSED");
  });

  it("reconciles commit-unknown and retries one pre-submit network failure", async () => {
    const unknownContext = await createContext();
    const owner = await login(unknownContext, "student2");
    const claimed = await claim(unknownContext, owner);
    unknownContext.gateway.queueFault("TransferTicket", {
      kind: "COMMIT_UNKNOWN",
    });
    const reconciled = await transfer(
      unknownContext,
      owner,
      claimed.body.data.id as string,
      studentIds.loser,
    );
    expect(reconciled.status).toBe(200);
    expect(reconciled.body.data).toMatchObject({
      ownerId: studentIds.loser,
      transferCount: 1,
    });
    expect(
      unknownContext.gateway
        .snapshot()
        .operations.filter(({ type }) => type === "TICKET_TRANSFERRED"),
    ).toHaveLength(1);

    const retryContext = await createContext();
    const retryOwner = await login(retryContext, "student2");
    const retryClaim = await claim(retryContext, retryOwner);
    retryContext.gateway.queueFault("TransferTicket", { kind: "NETWORK" });
    const retried = await transfer(
      retryContext,
      retryOwner,
      retryClaim.body.data.id as string,
      studentIds.loser,
    );
    expect(retried.status).toBe(200);
    expect(retried.body.data.ownerId).toBe(studentIds.loser);
    expect(
      retryContext.gateway
        .snapshot()
        .operations.filter(({ type }) => type === "TICKET_TRANSFERRED"),
    ).toHaveLength(1);
  });
});

describe("G4 and G5 ticket redemption", () => {
  it("enforces the inspector role and the half-open check-in window", async () => {
    const context = await createContext();
    const owner = await login(context, "student2");
    const inspector = await login(context, "inspector1");
    const claimed = await claim(context, owner);
    const ticketId = claimed.body.data.id as string;

    expect((await redeem(context, owner, ticketId)).status).toBe(403);
    const early = await redeem(context, inspector, ticketId);
    expect(early.status).toBe(422);
    expect(early.body.error.code).toBe("CHECKIN_CLOSED");

    context.clock.now = new Date(endAt);
    const ended = await redeem(context, inspector, ticketId);
    expect(ended.status).toBe(422);
    expect(ended.body.error.code).toBe("CHECKIN_CLOSED");
  });

  it("redeems at the exact start with the operation from that confirmed transaction", async () => {
    const context = await createContext();
    const owner = await login(context, "student2");
    const recipient = await login(context, "student1");
    const inspector = await login(context, "inspector1");
    const claimed = await claim(context, owner);
    const ticketId = claimed.body.data.id as string;
    expect(
      (await transfer(context, owner, ticketId, studentIds.loser)).status,
    ).toBe(200);

    context.clock.now = new Date(startAt);
    const response = await redeem(context, inspector, ticketId);
    expect(response.status).toBe(200);
    expect(response.body.data.ticket).toMatchObject({
      id: ticketId,
      ownerId: studentIds.loser,
      status: "REDEEMED",
      transferCount: 1,
      redeemedAt: startAt,
      event: {
        id: eventId,
        issuedCount: 1,
        redeemedCount: 1,
      },
    });
    const operation = response.body.data.operation;
    expect(operation).toMatchObject({
      id: operation.txId,
      eventId,
      ticketId,
      type: "TICKET_REDEEMED",
      actorId: inspectorId,
      fromUserId: studentIds.loser,
      toUserId: null,
      occurredAt: startAt,
      channelName: "test-channel",
      chaincodeName: "fairpass",
      blockNumber: null,
    });
    expect(operation.txId).toMatch(/^mock-/);

    const ledgerOperations = context.gateway
      .snapshot()
      .operations.filter(({ type }) => type === "TICKET_REDEEMED");
    expect(ledgerOperations).toEqual([operation]);

    const duplicate = await redeem(context, inspector, ticketId);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("ALREADY_REDEEMED");

    const transferAfterRedeem = await transfer(
      context,
      recipient,
      ticketId,
      studentIds.otherWinner,
    );
    expect(transferAfterRedeem.status).toBe(409);
    expect(transferAfterRedeem.body.error.code).toBe("ALREADY_REDEEMED");
  });

  it("reconciles commit-unknown by exact txId and safely retries a network failure", async () => {
    for (const fault of ["COMMIT_UNKNOWN", "NETWORK"] as const) {
      const context = await createContext();
      const owner = await login(context, "student2");
      const inspector = await login(context, "inspector1");
      const claimed = await claim(context, owner);
      const ticketId = claimed.body.data.id as string;
      context.clock.now = new Date(startAt);
      context.gateway.queueFault("RedeemTicket", { kind: fault });

      const response = await redeem(context, inspector, ticketId);
      expect(response.status).toBe(200);
      const operation = response.body.data.operation;
      expect(response.body.data.ticket.status).toBe("REDEEMED");
      expect(operation).toMatchObject({
        id: operation.txId,
        ticketId,
        type: "TICKET_REDEEMED",
        actorId: inspectorId,
      });
      const ledgerOperations = context.gateway
        .snapshot()
        .operations.filter(({ type }) => type === "TICKET_REDEEMED");
      expect(ledgerOperations).toHaveLength(1);
      expect(ledgerOperations[0]?.txId).toBe(operation.txId);
    }
  });
});
