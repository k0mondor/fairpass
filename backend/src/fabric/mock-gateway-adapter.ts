import { createHash, randomUUID } from "node:crypto";

import type { ApiErrorCode } from "../errors/api-error.js";
import type { Operation, OperationType, Ticket } from "../types/domain.js";
import { businessError, GatewayError, type GatewayErrorKind } from "./gateway-error.js";
import type {
  ChainEvent,
  ConfirmedSubmit,
  EvaluateMethod,
  GatewayAdapter,
  MockLedgerSnapshot,
  SubmitMethod,
} from "./types.js";

type GatewayMethod = EvaluateMethod | SubmitMethod;

export type MockFault =
  | {
      kind: Exclude<GatewayErrorKind, "BUSINESS" | "UNKNOWN">;
    }
  | {
      kind: "BUSINESS";
      code: ApiErrorCode;
    };

export interface MockGatewayAdapterOptions {
  channelName: string;
  chaincodeName: string;
  clock?: () => Date;
}

interface Eligibility {
  claimed: boolean;
}

export class MockGatewayAdapter implements GatewayAdapter {
  readonly mode = "mock" as const;

  private readonly events = new Map<string, ChainEvent>();
  private readonly tickets = new Map<string, Ticket>();
  private readonly ownerTickets = new Map<string, Set<string>>();
  private readonly eligibility = new Map<string, Eligibility>();
  private readonly operations: Operation[] = [];
  private readonly faults = new Map<GatewayMethod, MockFault[]>();
  private readonly clock: () => Date;

  constructor(private readonly options: MockGatewayAdapterOptions) {
    this.clock = options.clock ?? (() => new Date());
  }

  queueFault(method: GatewayMethod, fault: MockFault): void {
    const queue = this.faults.get(method) ?? [];
    queue.push(fault);
    this.faults.set(method, queue);
  }

  snapshot(): MockLedgerSnapshot {
    return structuredClone({
      events: [...this.events.values()],
      tickets: [...this.tickets.values()],
      operations: this.operations,
    });
  }

  async evaluate<T>(method: EvaluateMethod, args: readonly string[]): Promise<T> {
    this.throwPreExecutionFault(method);

    let result: unknown;
    switch (method) {
      case "GetEvent": {
        this.expectArgs(method, args, 1);
        result = this.requireEvent(args[0]!);
        break;
      }
      case "GetTicket": {
        this.expectArgs(method, args, 1);
        result = this.requireTicket(args[0]!);
        break;
      }
      case "GetTicketsByOwner": {
        this.expectArgs(method, args, 1);
        const ticketIds = this.ownerTickets.get(args[0]!) ?? new Set<string>();
        result = [...ticketIds]
          .map((ticketId) => this.tickets.get(ticketId))
          .filter((ticket): ticket is Ticket => ticket !== undefined)
          .sort((left, right) => left.id.localeCompare(right.id));
        break;
      }
      case "GetOperationsByEvent": {
        this.expectArgs(method, args, 1);
        result = this.operationsFor((operation) => operation.eventId === args[0]);
        break;
      }
      case "GetOperationsByTicket": {
        this.expectArgs(method, args, 1);
        result = this.operationsFor((operation) => operation.ticketId === args[0]);
        break;
      }
    }

    return structuredClone(result) as T;
  }

  async submitAndConfirm<T>(
    method: SubmitMethod,
    args: readonly string[],
  ): Promise<ConfirmedSubmit<T>> {
    const queuedFault = this.takeFault(method);
    if (queuedFault && queuedFault.kind !== "COMMIT_UNKNOWN") {
      this.throwFault(method, queuedFault);
    }

    const txId = `mock-${randomUUID()}`;
    const occurredAt = this.clock().toISOString();
    const { result, operation } = this.executeSubmit(method, args, txId, occurredAt);

    if (queuedFault?.kind === "COMMIT_UNKNOWN") {
      throw new GatewayError(
        "COMMIT_UNKNOWN",
        `Mock commit result is unknown for ${method}`,
        { txId },
      );
    }

    return {
      result: structuredClone(result) as T,
      txId,
      commitStatus: "VALID",
      blockNumber: null,
      gatewayMode: "mock",
      operation: structuredClone(operation),
    };
  }

  private executeSubmit(
    method: SubmitMethod,
    args: readonly string[],
    txId: string,
    occurredAt: string,
  ): { result: ChainEvent | Ticket; operation: Operation } {
    switch (method) {
      case "CreateEvent":
        return this.createEvent(args, txId, occurredAt);
      case "PublishDraw":
        return this.publishDraw(args, txId, occurredAt);
      case "ClaimTicket":
        return this.claimTicket(args, txId, occurredAt);
      case "TransferTicket":
        return this.transferTicket(args, txId, occurredAt);
      case "RedeemTicket":
        return this.redeemTicket(args, txId, occurredAt);
    }
  }

  private createEvent(
    args: readonly string[],
    txId: string,
    occurredAt: string,
  ): { result: ChainEvent; operation: Operation } {
    this.expectArgs("CreateEvent", args, 5);
    const [eventId, organizerId, capacityValue, startAt, endAt] = args as readonly [
      string,
      string,
      string,
      string,
      string,
    ];
    const capacity = this.positiveInteger(capacityValue, "capacity");
    this.requireText(eventId, "eventId");
    this.requireText(organizerId, "organizerId");
    const startTime = this.timestamp(startAt, "startAt");
    const endTime = this.timestamp(endAt, "endAt");
    if (startTime >= endTime) {
      throw businessError("VALIDATION_ERROR", "startAt must be before endAt");
    }
    if (this.events.has(eventId)) {
      throw businessError("IDEMPOTENCY_CONFLICT", "event already exists");
    }

    const event: ChainEvent = {
      eventId,
      organizerId,
      capacity,
      startAt,
      endAt,
      drawPublished: false,
      winnersHash: null,
      winnerCount: 0,
      issuedCount: 0,
      redeemedCount: 0,
    };
    this.events.set(eventId, event);
    const operation = this.recordOperation({
      txId,
      eventId,
      ticketId: null,
      type: "EVENT_CREATED",
      actorId: organizerId,
      fromUserId: null,
      toUserId: null,
      occurredAt,
    });
    return { result: event, operation };
  }

  private publishDraw(
    args: readonly string[],
    txId: string,
    occurredAt: string,
  ): { result: ChainEvent; operation: Operation } {
    this.expectArgs("PublishDraw", args, 3);
    const [eventId, winnerIdsJson, winnersHash] = args as readonly [
      string,
      string,
      string,
    ];
    const event = this.requireEvent(eventId);
    if (event.drawPublished) {
      throw businessError("ALREADY_DRAWN", "draw was already published");
    }
    if (this.clock().getTime() >= this.timestamp(event.startAt, "startAt")) {
      throw businessError("DRAW_NOT_READY", "event has already started");
    }

    const winnerIds = this.winnerIds(winnerIdsJson);
    if (winnerIds.length > event.capacity) {
      throw businessError("SOLD_OUT", "winner count exceeds capacity");
    }
    const canonicalJson = JSON.stringify(winnerIds);
    const calculatedHash = createHash("sha256").update(canonicalJson).digest("hex");
    if (calculatedHash !== winnersHash) {
      throw businessError("VALIDATION_ERROR", "winners hash does not match");
    }

    for (const winnerId of winnerIds) {
      this.eligibility.set(this.eligibilityKey(eventId, winnerId), {
        claimed: false,
      });
    }
    event.drawPublished = true;
    event.winnersHash = winnersHash;
    event.winnerCount = winnerIds.length;
    const operation = this.recordOperation({
      txId,
      eventId,
      ticketId: null,
      type: "DRAW_PUBLISHED",
      actorId: event.organizerId,
      fromUserId: null,
      toUserId: null,
      occurredAt,
    });
    return { result: event, operation };
  }

  private claimTicket(
    args: readonly string[],
    txId: string,
    occurredAt: string,
  ): { result: Ticket; operation: Operation } {
    this.expectArgs("ClaimTicket", args, 2);
    const [eventId, winnerId] = args as readonly [string, string];
    const event = this.requireEvent(eventId);
    if (!event.drawPublished) {
      throw businessError("DRAW_NOT_READY", "draw has not been published");
    }
    if (this.clock().getTime() >= this.timestamp(event.startAt, "startAt")) {
      throw businessError("CLAIM_CLOSED", "event has started");
    }
    const eligibility = this.eligibility.get(this.eligibilityKey(eventId, winnerId));
    if (!eligibility) {
      throw businessError("NOT_WINNER", "winner eligibility does not exist");
    }
    if (eligibility.claimed) {
      throw businessError("ALREADY_CLAIMED", "winner already claimed a ticket");
    }
    if (event.issuedCount >= event.capacity) {
      throw businessError("SOLD_OUT", "event ticket capacity reached");
    }

    const ticketId = createHash("sha256")
      .update(`ticket:${eventId}:${winnerId}`)
      .digest("hex");
    if (this.tickets.has(ticketId)) {
      throw businessError("ALREADY_CLAIMED", "ticket already exists");
    }

    const ticket: Ticket = {
      id: ticketId,
      eventId,
      originalWinnerId: winnerId,
      ownerId: winnerId,
      status: "ACTIVE",
      transferCount: 0,
      claimedAt: occurredAt,
      redeemedAt: null,
    };
    eligibility.claimed = true;
    event.issuedCount += 1;
    this.tickets.set(ticketId, ticket);
    this.addOwnerTicket(winnerId, ticketId);
    const operation = this.recordOperation({
      txId,
      eventId,
      ticketId,
      type: "TICKET_CLAIMED",
      actorId: winnerId,
      fromUserId: null,
      toUserId: winnerId,
      occurredAt,
    });
    return { result: ticket, operation };
  }

  private transferTicket(
    args: readonly string[],
    txId: string,
    occurredAt: string,
  ): { result: Ticket; operation: Operation } {
    this.expectArgs("TransferTicket", args, 3);
    const [ticketId, fromUserId, toUserId] = args as readonly [
      string,
      string,
      string,
    ];
    const ticket = this.requireTicket(ticketId);
    const event = this.requireEvent(ticket.eventId);
    if (ticket.ownerId !== fromUserId) {
      throw businessError("NOT_TICKET_OWNER", "fromUserId is not the current owner");
    }
    if (fromUserId === toUserId || toUserId.trim() === "") {
      throw businessError("INVALID_RECIPIENT", "recipient must be different");
    }
    if (ticket.status === "REDEEMED") {
      throw businessError("ALREADY_REDEEMED", "ticket was already redeemed");
    }
    if (ticket.transferCount >= 1) {
      throw businessError("TRANSFER_LIMIT_REACHED", "ticket can only be transferred once");
    }
    if (this.clock().getTime() >= this.timestamp(event.startAt, "startAt")) {
      throw businessError("TRANSFER_CLOSED", "event has started");
    }

    this.removeOwnerTicket(fromUserId, ticketId);
    this.addOwnerTicket(toUserId, ticketId);
    ticket.ownerId = toUserId;
    ticket.transferCount += 1;
    const operation = this.recordOperation({
      txId,
      eventId: ticket.eventId,
      ticketId,
      type: "TICKET_TRANSFERRED",
      actorId: fromUserId,
      fromUserId,
      toUserId,
      occurredAt,
    });
    return { result: ticket, operation };
  }

  private redeemTicket(
    args: readonly string[],
    txId: string,
    occurredAt: string,
  ): { result: Ticket; operation: Operation } {
    this.expectArgs("RedeemTicket", args, 2);
    const [ticketId, inspectorId] = args as readonly [string, string];
    const ticket = this.requireTicket(ticketId);
    const event = this.requireEvent(ticket.eventId);
    if (ticket.status === "REDEEMED") {
      throw businessError("ALREADY_REDEEMED", "ticket was already redeemed");
    }
    const now = this.clock().getTime();
    if (
      now < this.timestamp(event.startAt, "startAt") ||
      now >= this.timestamp(event.endAt, "endAt")
    ) {
      throw businessError("CHECKIN_CLOSED", "event is not in its check-in window");
    }

    ticket.status = "REDEEMED";
    ticket.redeemedAt = occurredAt;
    event.redeemedCount += 1;
    const operation = this.recordOperation({
      txId,
      eventId: ticket.eventId,
      ticketId,
      type: "TICKET_REDEEMED",
      actorId: inspectorId,
      fromUserId: ticket.ownerId,
      toUserId: null,
      occurredAt,
    });
    return { result: ticket, operation };
  }

  private winnerIds(value: string): string[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw businessError("VALIDATION_ERROR", "winnerIdsJson is not valid JSON");
    }
    if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== "string" || id === "")) {
      throw businessError("VALIDATION_ERROR", "winnerIdsJson must be a string array");
    }
    const winnerIds = parsed as string[];
    const sortedUnique = [...new Set(winnerIds)].sort((left, right) =>
      left.localeCompare(right),
    );
    if (JSON.stringify(winnerIds) !== JSON.stringify(sortedUnique)) {
      throw businessError("VALIDATION_ERROR", "winner IDs must be sorted and unique");
    }
    return winnerIds;
  }

  private recordOperation(input: {
    txId: string;
    eventId: string;
    ticketId: string | null;
    type: OperationType;
    actorId: string;
    fromUserId: string | null;
    toUserId: string | null;
    occurredAt: string;
  }): Operation {
    const operation: Operation = {
      id: input.txId,
      eventId: input.eventId,
      ticketId: input.ticketId,
      type: input.type,
      actorId: input.actorId,
      fromUserId: input.fromUserId,
      toUserId: input.toUserId,
      occurredAt: input.occurredAt,
      txId: input.txId,
      channelName: this.options.channelName,
      chaincodeName: this.options.chaincodeName,
      blockNumber: null,
    };
    this.operations.push(operation);
    return operation;
  }

  private operationsFor(predicate: (operation: Operation) => boolean): Operation[] {
    return this.operations
      .filter(predicate)
      .sort((left, right) =>
        right.occurredAt.localeCompare(left.occurredAt) ||
        right.txId.localeCompare(left.txId),
      );
  }

  private requireEvent(eventId: string): ChainEvent {
    const event = this.events.get(eventId);
    if (!event) throw businessError("NOT_FOUND", "event does not exist");
    return event;
  }

  private requireTicket(ticketId: string): Ticket {
    const ticket = this.tickets.get(ticketId);
    if (!ticket) throw businessError("NOT_FOUND", "ticket does not exist");
    return ticket;
  }

  private addOwnerTicket(ownerId: string, ticketId: string): void {
    const ticketIds = this.ownerTickets.get(ownerId) ?? new Set<string>();
    ticketIds.add(ticketId);
    this.ownerTickets.set(ownerId, ticketIds);
  }

  private removeOwnerTicket(ownerId: string, ticketId: string): void {
    const ticketIds = this.ownerTickets.get(ownerId);
    if (!ticketIds) return;
    ticketIds.delete(ticketId);
    if (ticketIds.size === 0) this.ownerTickets.delete(ownerId);
  }

  private eligibilityKey(eventId: string, userId: string): string {
    return `${eventId}:${userId}`;
  }

  private expectArgs(method: GatewayMethod, args: readonly string[], count: number): void {
    if (args.length !== count) {
      throw businessError(
        "VALIDATION_ERROR",
        `${method} expects ${count} arguments but received ${args.length}`,
      );
    }
  }

  private requireText(value: string, name: string): void {
    if (value.trim() === "") {
      throw businessError("VALIDATION_ERROR", `${name} is required`);
    }
  }

  private positiveInteger(value: string, name: string): number {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw businessError("VALIDATION_ERROR", `${name} must be a positive integer`);
    }
    return parsed;
  }

  private timestamp(value: string, name: string): number {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) {
      throw businessError("VALIDATION_ERROR", `${name} must be an ISO timestamp`);
    }
    return parsed;
  }

  private takeFault(method: GatewayMethod): MockFault | undefined {
    const queue = this.faults.get(method);
    const fault = queue?.shift();
    if (queue?.length === 0) this.faults.delete(method);
    return fault;
  }

  private throwPreExecutionFault(method: GatewayMethod): void {
    const fault = this.takeFault(method);
    if (fault) this.throwFault(method, fault);
  }

  private throwFault(method: GatewayMethod, fault: MockFault): never {
    if (fault.kind === "BUSINESS") {
      throw businessError(fault.code, `Injected ${fault.code} fault for ${method}`);
    }
    throw new GatewayError(fault.kind, `Injected ${fault.kind} fault for ${method}`);
  }
}
