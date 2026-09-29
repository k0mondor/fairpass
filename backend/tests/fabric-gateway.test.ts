import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { ApiError } from "../src/errors/api-error.js";
import {
  GatewayError,
  parseChaincodeError,
  toApiError,
} from "../src/fabric/gateway-error.js";
import { MockGatewayAdapter } from "../src/fabric/mock-gateway-adapter.js";
import type { ChainEvent } from "../src/fabric/types.js";
import { UnavailableGatewayAdapter } from "../src/fabric/unavailable-gateway-adapter.js";
import { GatewayLedgerReadService } from "../src/services/ledger-read-service.js";
import type { Operation, Ticket } from "../src/types/domain.js";

const eventId = "event-1";
const organizerId = "organizer-1";
const winnerId = "student-1";
const recipientId = "student-2";
const inspectorId = "inspector-1";
const startAt = "2026-10-02T10:00:00.000Z";
const endAt = "2026-10-02T12:00:00.000Z";

const hashWinners = (winnerIds: readonly string[]) =>
  createHash("sha256").update(JSON.stringify(winnerIds)).digest("hex");

const createGateway = (clock: { now: Date }) =>
  new MockGatewayAdapter({
    channelName: "test-channel",
    chaincodeName: "fairpass",
    clock: () => clock.now,
  });

const createEvent = (gateway: MockGatewayAdapter) =>
  gateway.submitAndConfirm<ChainEvent>("CreateEvent", [
    eventId,
    organizerId,
    "2",
    startAt,
    endAt,
  ]);

const publishDraw = (gateway: MockGatewayAdapter) => {
  const winners = [winnerId];
  return gateway.submitAndConfirm<ChainEvent>("PublishDraw", [
    eventId,
    JSON.stringify(winners),
    hashWinners(winners),
  ]);
};

describe("MockGatewayAdapter", () => {
  it("runs the confirmed ticket lifecycle and keeps indexes and operations consistent", async () => {
    const clock = { now: new Date("2026-09-29T00:00:00.000Z") };
    const gateway = createGateway(clock);

    const created = await createEvent(gateway);
    const drawn = await publishDraw(gateway);
    const claimed = await gateway.submitAndConfirm<Ticket>("ClaimTicket", [
      eventId,
      winnerId,
    ]);
    const transferred = await gateway.submitAndConfirm<Ticket>("TransferTicket", [
      claimed.result.id,
      winnerId,
      recipientId,
    ]);

    expect(created.txId).toMatch(/^mock-/);
    expect(created.blockNumber).toBeNull();
    expect(created.gatewayMode).toBe("mock");
    expect(created.operation).toMatchObject({
      id: created.txId,
      txId: created.txId,
      type: "EVENT_CREATED",
      blockNumber: null,
    });
    expect(drawn.result).toMatchObject({
      drawPublished: true,
      winnerCount: 1,
    });
    expect(transferred.result).toMatchObject({
      ownerId: recipientId,
      transferCount: 1,
    });
    expect(
      await gateway.evaluate<Ticket[]>("GetTicketsByOwner", [winnerId]),
    ).toEqual([]);
    expect(
      await gateway.evaluate<Ticket[]>("GetTicketsByOwner", [recipientId]),
    ).toEqual([transferred.result]);

    clock.now = new Date("2026-10-02T10:30:00.000Z");
    const redeemed = await gateway.submitAndConfirm<Ticket>("RedeemTicket", [
      claimed.result.id,
      inspectorId,
    ]);
    expect(redeemed.result).toMatchObject({
      ownerId: recipientId,
      status: "REDEEMED",
      redeemedAt: clock.now.toISOString(),
    });
    expect(redeemed.operation).toMatchObject({
      id: redeemed.txId,
      txId: redeemed.txId,
      type: "TICKET_REDEEMED",
      actorId: inspectorId,
      fromUserId: recipientId,
    });

    const event = await gateway.evaluate<ChainEvent>("GetEvent", [eventId]);
    expect(event).toMatchObject({ issuedCount: 1, redeemedCount: 1 });
    const operations = await gateway.evaluate<Operation[]>(
      "GetOperationsByEvent",
      [eventId],
    );
    expect(operations).toHaveLength(5);
    expect(operations.map(({ type }) => type)).toEqual(
      expect.arrayContaining([
        "EVENT_CREATED",
        "DRAW_PUBLISHED",
        "TICKET_CLAIMED",
        "TICKET_TRANSFERRED",
        "TICKET_REDEEMED",
      ]),
    );
    expect(operations.every(({ txId }) => txId.startsWith("mock-"))).toBe(true);
    expect(operations.every(({ blockNumber }) => blockNumber === null)).toBe(true);
  });

  it("enforces chaincode business rules and exposes only stable public errors", async () => {
    const clock = { now: new Date("2026-09-29T00:00:00.000Z") };
    const gateway = createGateway(clock);
    await createEvent(gateway);
    await publishDraw(gateway);

    let caught: unknown;
    try {
      await gateway.submitAndConfirm("ClaimTicket", [eventId, "not-a-winner"]);
    } catch (error) {
      caught = error;
    }
    const mapped = toApiError(caught);
    expect(mapped).toMatchObject({ code: "NOT_WINNER", status: 409 });
    expect(mapped.message).toBe("当前用户未中签");
    expect(mapped.message).not.toContain("eligibility");

    await expect(createEvent(gateway)).rejects.toMatchObject({
      kind: "BUSINESS",
      businessCode: "IDEMPOTENCY_CONFLICT",
    });
  });

  it("injects pre-commit faults without state changes", async () => {
    const clock = { now: new Date("2026-09-29T00:00:00.000Z") };
    const gateway = createGateway(clock);
    gateway.queueFault("CreateEvent", { kind: "NETWORK" });

    await expect(createEvent(gateway)).rejects.toMatchObject({ kind: "NETWORK" });
    await expect(gateway.evaluate("GetEvent", [eventId])).rejects.toMatchObject({
      businessCode: "NOT_FOUND",
    });
    expect(gateway.snapshot()).toEqual({ events: [], tickets: [], operations: [] });
  });

  it("injects an explicit timeout without pretending the transaction succeeded", async () => {
    const clock = { now: new Date("2026-09-29T00:00:00.000Z") };
    const gateway = createGateway(clock);
    gateway.queueFault("CreateEvent", { kind: "TIMEOUT" });

    await expect(createEvent(gateway)).rejects.toMatchObject({ kind: "TIMEOUT" });
    expect(gateway.snapshot().events).toEqual([]);
  });

  it("models commit-unknown after applying state so callers can reconcile by read", async () => {
    const clock = { now: new Date("2026-09-29T00:00:00.000Z") };
    const gateway = createGateway(clock);
    gateway.queueFault("CreateEvent", { kind: "COMMIT_UNKNOWN" });

    let caught: unknown;
    try {
      await createEvent(gateway);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GatewayError);
    expect(caught).toMatchObject({ kind: "COMMIT_UNKNOWN" });
    expect((caught as GatewayError).txId).toMatch(/^mock-/);

    const event = await gateway.evaluate<ChainEvent>("GetEvent", [eventId]);
    expect(event).toMatchObject({ eventId, organizerId });
    expect(gateway.snapshot().operations).toHaveLength(1);
  });
});

describe("Fabric Gateway error and read boundary", () => {
  it("parses CODE:message failures and maps unknown infrastructure details to 503", () => {
    const parsed = parseChaincodeError(
      new Error("endorse failed: TRANSFER_LIMIT_REACHED:already transferred"),
    );
    expect(parsed).toMatchObject({
      kind: "BUSINESS",
      businessCode: "TRANSFER_LIMIT_REACHED",
    });
    expect(toApiError(parsed)).toMatchObject({
      code: "TRANSFER_LIMIT_REACHED",
      status: 409,
    });

    const unknown = toApiError(new Error("peer 10.0.0.2 leaked internal detail"));
    expect(unknown).toMatchObject({ code: "FABRIC_UNAVAILABLE", status: 503 });
    expect(unknown.message).toBe("Fabric Gateway 暂不可用");
  });

  it("reads confirmed counts and current ownership through the common interface", async () => {
    const clock = { now: new Date("2026-09-29T00:00:00.000Z") };
    const gateway = createGateway(clock);
    await createEvent(gateway);
    await publishDraw(gateway);
    const claimed = await gateway.submitAndConfirm<Ticket>("ClaimTicket", [
      eventId,
      winnerId,
    ]);
    const ledger = new GatewayLedgerReadService(gateway);

    await expect(ledger.getTicketCounts(eventId)).resolves.toEqual({
      issuedCount: 1,
      redeemedCount: 0,
    });
    await expect(
      ledger.findTicketByOwnerForEvent(winnerId, eventId),
    ).resolves.toEqual(claimed.result);
  });

  it("keeps real mode unavailable until credentials and the SDK adapter are wired", async () => {
    const gateway = new UnavailableGatewayAdapter("not configured");
    const ledger = new GatewayLedgerReadService(gateway);

    await expect(ledger.getTicketCounts(eventId)).rejects.toEqual(
      expect.objectContaining<Partial<ApiError>>({
        code: "FABRIC_UNAVAILABLE",
        status: 503,
      }),
    );
  });
});
