import { createHash } from "node:crypto";

import type { DrawRepository } from "../db/repositories/draw-repository.js";
import type { UserRepository } from "../db/repositories/user-repository.js";
import { ApiError } from "../errors/api-error.js";
import {
  parseChaincodeError,
  toApiError,
  type GatewayError,
} from "../fabric/gateway-error.js";
import type {
  ConfirmedSubmit,
  GatewayAdapter,
} from "../fabric/types.js";
import type {
  Event,
  Operation,
  PageResult,
  Ticket,
  TicketWithEvent,
  User,
} from "../types/domain.js";
import type { DateClock, EventService } from "./event-service.js";

export interface ClaimTicketResult {
  ticket: Ticket;
  txId: string | null;
}

export interface TransferTicketResult {
  ticket: Ticket;
  txId: string | null;
}

export interface RedeemTicketResult {
  ticket: TicketWithEvent;
  operation: Operation;
}

const systemClock: DateClock = () => new Date();
const ticketIdFor = (eventId: string, winnerId: string): string =>
  createHash("sha256")
    .update(`ticket:${eventId}:${winnerId}`, "utf8")
    .digest("hex");

export class TicketService {
  constructor(
    private readonly draws: DrawRepository,
    private readonly users: UserRepository,
    private readonly gateway: GatewayAdapter,
    private readonly events: EventService,
    private readonly clock: DateClock = systemClock,
  ) {}

  async claim(eventId: string, actorId: string): Promise<ClaimTicketResult> {
    const event = this.events.findRecord(eventId);
    if (this.clock().getTime() >= Date.parse(event.startAt)) {
      throw new ApiError("CLAIM_CLOSED", "活动已经开始，不能领票");
    }
    if (
      event.storedStatus !== "DRAWN" ||
      !this.draws.isConfirmedWinner(eventId, actorId)
    ) {
      throw new ApiError("NOT_WINNER", "当前用户没有已确认的中签资格");
    }

    const expectedTicketId = ticketIdFor(eventId, actorId);
    const existing = await this.findTicket(expectedTicketId);
    if (existing) {
      this.assertTicketIdentity(existing, expectedTicketId, eventId, actorId);
      throw new ApiError("ALREADY_CLAIMED", "票已领取");
    }

    return this.submitClaim(eventId, actorId, expectedTicketId, true);
  }

  async listForStudent(
    ownerId: string,
    page: number,
    pageSize: number,
  ): Promise<PageResult<TicketWithEvent>> {
    const tickets = await this.readOwnerTickets(ownerId);
    const sorted = [...tickets].sort(
      (left, right) =>
        right.claimedAt.localeCompare(left.claimedAt) ||
        right.id.localeCompare(left.id),
    );
    const start = (page - 1) * pageSize;
    const selected = sorted.slice(start, start + pageSize);

    return {
      data: await this.attachEvents(selected),
      page,
      pageSize,
      total: sorted.length,
    };
  }

  async get(ticketId: string, actor: User): Promise<TicketWithEvent> {
    const ticket = await this.findTicket(ticketId);
    if (!ticket) throw new ApiError("NOT_FOUND", "门票不存在");
    if (ticket.id !== ticketId) {
      throw new ApiError(
        "FABRIC_UNAVAILABLE",
        "链上门票查询结果与请求不一致",
      );
    }
    this.assertTicketShape(ticket);

    const eventRecord = this.findLocalEvent(ticket.eventId);
    const canRead =
      actor.role === "INSPECTOR" ||
      ticket.ownerId === actor.id ||
      (actor.role === "ORGANIZER" && eventRecord.organizerId === actor.id);
    if (!canRead) throw new ApiError("FORBIDDEN", "无权查看此门票");

    return {
      ...ticket,
      event: await this.events.toEvent(eventRecord),
    };
  }

  async transfer(
    ticketId: string,
    actorId: string,
    toUserId: string,
  ): Promise<TransferTicketResult> {
    const ticket = await this.findTicket(ticketId);
    if (!ticket) throw new ApiError("NOT_FOUND", "门票不存在");
    if (ticket.id !== ticketId) {
      throw new ApiError("FABRIC_UNAVAILABLE", "链上门票查询结果与请求不一致");
    }
    this.assertTicketShape(ticket);
    if (ticket.ownerId !== actorId) {
      throw new ApiError("NOT_TICKET_OWNER", "当前用户不是票的持有人");
    }

    const recipient = this.users.findById(toUserId);
    if (toUserId === actorId || recipient?.role !== "STUDENT") {
      throw new ApiError("INVALID_RECIPIENT", "接收人必须是其他学生账号");
    }
    if (ticket.status === "REDEEMED") {
      throw new ApiError("ALREADY_REDEEMED", "票已核销");
    }
    if (ticket.transferCount >= 1) {
      throw new ApiError("TRANSFER_LIMIT_REACHED", "票已达到转让次数上限");
    }

    const event = this.findLocalEvent(ticket.eventId);
    if (this.clock().getTime() >= Date.parse(event.startAt)) {
      throw new ApiError("TRANSFER_CLOSED", "活动已经开始，不能转让");
    }

    return this.submitTransfer(ticket, actorId, toUserId, true);
  }

  async redeem(
    ticketId: string,
    inspectorId: string,
  ): Promise<RedeemTicketResult> {
    const ticket = await this.findTicket(ticketId);
    if (!ticket) throw new ApiError("NOT_FOUND", "门票不存在");
    if (ticket.id !== ticketId) {
      throw new ApiError("FABRIC_UNAVAILABLE", "链上门票查询结果与请求不一致");
    }
    this.assertTicketShape(ticket);
    if (ticket.status === "REDEEMED") {
      throw new ApiError("ALREADY_REDEEMED", "票已核销");
    }

    const event = this.findLocalEvent(ticket.eventId);
    const now = this.clock().getTime();
    if (now < Date.parse(event.startAt) || now >= Date.parse(event.endAt)) {
      throw new ApiError("CHECKIN_CLOSED", "当前不在检票时间内");
    }

    const result = await this.submitRedeem(ticket, inspectorId, true);
    return {
      ticket: {
        ...result.ticket,
        event: await this.events.toEvent(event),
      },
      operation: result.operation,
    };
  }

  private async submitClaim(
    eventId: string,
    actorId: string,
    expectedTicketId: string,
    allowRetryAfterNotFound: boolean,
  ): Promise<ClaimTicketResult> {
    let confirmed: ConfirmedSubmit<Ticket>;
    try {
      confirmed = await this.gateway.submitAndConfirm<Ticket>("ClaimTicket", [
        eventId,
        actorId,
      ]);
    } catch (error) {
      return this.handleClaimFailure(
        eventId,
        actorId,
        expectedTicketId,
        allowRetryAfterNotFound,
        error,
      );
    }

    this.assertFreshClaim(
      confirmed.result,
      expectedTicketId,
      eventId,
      actorId,
    );
    return { ticket: confirmed.result, txId: confirmed.txId };
  }

  private async handleClaimFailure(
    eventId: string,
    actorId: string,
    expectedTicketId: string,
    allowRetryAfterNotFound: boolean,
    error: unknown,
  ): Promise<ClaimTicketResult> {
    const gatewayError = parseChaincodeError(error);
    if (gatewayError.kind === "BUSINESS") throw toApiError(gatewayError);

    const ticket = await this.findTicket(expectedTicketId);
    if (ticket) {
      this.assertTicketIdentity(ticket, expectedTicketId, eventId, actorId);
      return { ticket, txId: gatewayError.txId ?? null };
    }
    if (allowRetryAfterNotFound) {
      return this.submitClaim(eventId, actorId, expectedTicketId, false);
    }
    throw toApiError(gatewayError);
  }

  private async submitTransfer(
    before: Ticket,
    actorId: string,
    toUserId: string,
    allowRetryAfterUnchanged: boolean,
  ): Promise<TransferTicketResult> {
    let confirmed: ConfirmedSubmit<Ticket>;
    try {
      confirmed = await this.gateway.submitAndConfirm<Ticket>("TransferTicket", [
        before.id,
        actorId,
        toUserId,
      ]);
    } catch (error) {
      return this.handleTransferFailure(
        before,
        actorId,
        toUserId,
        allowRetryAfterUnchanged,
        error,
      );
    }

    this.assertTransferredTicket(confirmed.result, before, toUserId);
    return { ticket: confirmed.result, txId: confirmed.txId };
  }

  private async handleTransferFailure(
    before: Ticket,
    actorId: string,
    toUserId: string,
    allowRetryAfterUnchanged: boolean,
    error: unknown,
  ): Promise<TransferTicketResult> {
    const gatewayError = parseChaincodeError(error);
    if (gatewayError.kind === "BUSINESS") throw toApiError(gatewayError);

    const current = await this.findTicket(before.id);
    if (!current) {
      throw new ApiError(
        "FABRIC_UNAVAILABLE",
        "转让后无法确认链上门票状态",
        { cause: error },
      );
    }
    if (this.isTransferredTicket(current, before, toUserId)) {
      return { ticket: current, txId: gatewayError.txId ?? null };
    }
    if (allowRetryAfterUnchanged && this.isUnchangedTicket(current, before)) {
      return this.submitTransfer(before, actorId, toUserId, false);
    }
    throw new ApiError(
      "FABRIC_UNAVAILABLE",
      "无法确认门票转让交易状态",
      { cause: error },
    );
  }

  private async submitRedeem(
    before: Ticket,
    inspectorId: string,
    allowRetryAfterUnchanged: boolean,
  ): Promise<{ ticket: Ticket; operation: Operation }> {
    let confirmed: ConfirmedSubmit<Ticket>;
    try {
      confirmed = await this.gateway.submitAndConfirm<Ticket>("RedeemTicket", [
        before.id,
        inspectorId,
      ]);
    } catch (error) {
      return this.handleRedeemFailure(
        before,
        inspectorId,
        allowRetryAfterUnchanged,
        error,
      );
    }

    this.assertRedeemedTicket(confirmed.result, before);
    if (!confirmed.operation) {
      throw new ApiError(
        "FABRIC_UNAVAILABLE",
        "核销确认缺少本次交易操作记录",
      );
    }
    this.assertRedeemOperation(
      confirmed.operation,
      confirmed.txId,
      confirmed.result,
      inspectorId,
    );
    return { ticket: confirmed.result, operation: confirmed.operation };
  }

  private async handleRedeemFailure(
    before: Ticket,
    inspectorId: string,
    allowRetryAfterUnchanged: boolean,
    error: unknown,
  ): Promise<{ ticket: Ticket; operation: Operation }> {
    const gatewayError = parseChaincodeError(error);
    if (gatewayError.kind === "BUSINESS") throw toApiError(gatewayError);

    const current = await this.findTicket(before.id);
    if (!current) {
      throw new ApiError(
        "FABRIC_UNAVAILABLE",
        "核销后无法确认链上门票状态",
        { cause: error },
      );
    }
    if (this.isRedeemedTicket(current, before)) {
      if (!gatewayError.txId) {
        throw new ApiError(
          "FABRIC_UNAVAILABLE",
          "门票已核销但无法确认本次交易标识",
          { cause: error },
        );
      }
      const operation = await this.findTicketOperation(
        before.id,
        gatewayError.txId,
      );
      if (!operation) {
        throw new ApiError(
          "FABRIC_UNAVAILABLE",
          "门票已核销但缺少本次确认操作记录",
          { cause: error },
        );
      }
      this.assertRedeemOperation(
        operation,
        gatewayError.txId,
        current,
        inspectorId,
      );
      return { ticket: current, operation };
    }
    if (allowRetryAfterUnchanged && this.isUnchangedTicket(current, before)) {
      return this.submitRedeem(before, inspectorId, false);
    }
    throw new ApiError(
      "FABRIC_UNAVAILABLE",
      "无法确认门票核销交易状态",
      { cause: error },
    );
  }

  private async findTicketOperation(
    ticketId: string,
    txId: string,
  ): Promise<Operation | null> {
    let operations: Operation[];
    try {
      operations = await this.gateway.evaluate<Operation[]>(
        "GetOperationsByTicket",
        [ticketId],
      );
    } catch (error) {
      throw toApiError(error);
    }
    const matches = operations.filter((operation) => operation.txId === txId);
    if (matches.length > 1) {
      throw new ApiError(
        "FABRIC_UNAVAILABLE",
        "链上核销操作记录存在重复交易标识",
      );
    }
    return matches[0] ?? null;
  }

  private async findTicket(ticketId: string): Promise<Ticket | null> {
    try {
      return await this.gateway.evaluate<Ticket>("GetTicket", [ticketId]);
    } catch (error) {
      const gatewayError = parseChaincodeError(error);
      if (
        gatewayError.kind === "BUSINESS" &&
        gatewayError.businessCode === "NOT_FOUND"
      ) {
        return null;
      }
      throw toApiError(gatewayError);
    }
  }

  private async readOwnerTickets(ownerId: string): Promise<Ticket[]> {
    let tickets: Ticket[];
    try {
      tickets = await this.gateway.evaluate<Ticket[]>("GetTicketsByOwner", [
        ownerId,
      ]);
    } catch (error) {
      throw toApiError(error);
    }

    const seen = new Set<string>();
    for (const ticket of tickets) {
      this.assertTicketShape(ticket);
      if (ticket.ownerId !== ownerId || seen.has(ticket.id)) {
        throw new ApiError(
          "FABRIC_UNAVAILABLE",
          "链上门票持有人索引不一致",
        );
      }
      seen.add(ticket.id);
    }
    return tickets;
  }

  private async attachEvents(
    tickets: readonly Ticket[],
  ): Promise<TicketWithEvent[]> {
    const events = new Map<string, Promise<Event>>();
    const eventFor = (eventId: string): Promise<Event> => {
      const existing = events.get(eventId);
      if (existing) return existing;
      const record = this.findLocalEvent(eventId);
      const pending = this.events.toEvent(record);
      events.set(eventId, pending);
      return pending;
    };

    return Promise.all(
      tickets.map(async (ticket) => ({
        ...ticket,
        event: await eventFor(ticket.eventId),
      })),
    );
  }

  private findLocalEvent(eventId: string) {
    try {
      return this.events.findRecord(eventId);
    } catch (error) {
      if (error instanceof ApiError && error.code === "NOT_FOUND") {
        throw new ApiError(
          "FABRIC_UNAVAILABLE",
          "链上门票对应的本地活动不存在",
          { cause: error },
        );
      }
      throw error;
    }
  }

  private assertFreshClaim(
    ticket: Ticket,
    expectedTicketId: string,
    eventId: string,
    actorId: string,
  ): void {
    this.assertTicketIdentity(ticket, expectedTicketId, eventId, actorId);
    if (
      ticket.ownerId !== actorId ||
      ticket.status !== "ACTIVE" ||
      ticket.transferCount !== 0 ||
      ticket.redeemedAt !== null
    ) {
      throw new ApiError(
        "FABRIC_UNAVAILABLE",
        "领票确认结果与请求不一致",
      );
    }
  }

  private assertTicketIdentity(
    ticket: Ticket,
    expectedTicketId: string,
    eventId: string,
    originalWinnerId: string,
  ): void {
    this.assertTicketShape(ticket);
    if (
      ticket.id !== expectedTicketId ||
      ticket.eventId !== eventId ||
      ticket.originalWinnerId !== originalWinnerId
    ) {
      throw new ApiError(
        "FABRIC_UNAVAILABLE",
        "链上门票与领票请求不一致",
      );
    }
  }

  private assertTransferredTicket(
    ticket: Ticket,
    before: Ticket,
    toUserId: string,
  ): void {
    if (!this.isTransferredTicket(ticket, before, toUserId)) {
      throw new ApiError(
        "FABRIC_UNAVAILABLE",
        "转让确认结果与请求不一致",
      );
    }
  }

  private isTransferredTicket(
    ticket: Ticket,
    before: Ticket,
    toUserId: string,
  ): boolean {
    this.assertTicketShape(ticket);
    return (
      this.hasSameTicketIdentity(ticket, before) &&
      ticket.ownerId === toUserId &&
      ticket.status === "ACTIVE" &&
      ticket.transferCount === before.transferCount + 1 &&
      ticket.claimedAt === before.claimedAt &&
      ticket.redeemedAt === null
    );
  }

  private assertRedeemedTicket(ticket: Ticket, before: Ticket): void {
    if (!this.isRedeemedTicket(ticket, before)) {
      throw new ApiError(
        "FABRIC_UNAVAILABLE",
        "核销确认结果与请求不一致",
      );
    }
  }

  private isRedeemedTicket(ticket: Ticket, before: Ticket): boolean {
    this.assertTicketShape(ticket);
    return (
      this.hasSameTicketIdentity(ticket, before) &&
      ticket.ownerId === before.ownerId &&
      ticket.status === "REDEEMED" &&
      ticket.transferCount === before.transferCount &&
      ticket.claimedAt === before.claimedAt &&
      ticket.redeemedAt !== null
    );
  }

  private isUnchangedTicket(ticket: Ticket, before: Ticket): boolean {
    this.assertTicketShape(ticket);
    return (
      this.hasSameTicketIdentity(ticket, before) &&
      ticket.ownerId === before.ownerId &&
      ticket.status === before.status &&
      ticket.transferCount === before.transferCount &&
      ticket.claimedAt === before.claimedAt &&
      ticket.redeemedAt === before.redeemedAt
    );
  }

  private hasSameTicketIdentity(ticket: Ticket, before: Ticket): boolean {
    return (
      ticket.id === before.id &&
      ticket.eventId === before.eventId &&
      ticket.originalWinnerId === before.originalWinnerId
    );
  }

  private assertRedeemOperation(
    operation: Operation,
    txId: string,
    ticket: Ticket,
    inspectorId: string,
  ): void {
    const occurredAt = Date.parse(operation.occurredAt);
    if (
      operation.id !== txId ||
      operation.txId !== txId ||
      operation.eventId !== ticket.eventId ||
      operation.ticketId !== ticket.id ||
      operation.type !== "TICKET_REDEEMED" ||
      operation.actorId !== inspectorId ||
      operation.fromUserId !== ticket.ownerId ||
      operation.toUserId !== null ||
      operation.occurredAt !== ticket.redeemedAt ||
      !Number.isFinite(occurredAt) ||
      operation.channelName.length === 0 ||
      operation.chaincodeName.length === 0 ||
      (operation.blockNumber !== null &&
        (!Number.isInteger(operation.blockNumber) || operation.blockNumber < 0))
    ) {
      throw new ApiError(
        "FABRIC_UNAVAILABLE",
        "核销操作记录与本次确认交易不一致",
      );
    }
  }

  private assertTicketShape(ticket: Ticket): void {
    const claimedAt = Date.parse(ticket.claimedAt);
    const redeemedAt =
      ticket.redeemedAt === null ? null : Date.parse(ticket.redeemedAt);
    if (
      !/^[0-9a-f]{64}$/.test(ticket.id) ||
      ticket.eventId.length === 0 ||
      ticket.originalWinnerId.length === 0 ||
      ticket.ownerId.length === 0 ||
      !["ACTIVE", "REDEEMED"].includes(ticket.status) ||
      !Number.isInteger(ticket.transferCount) ||
      ticket.transferCount < 0 ||
      ticket.transferCount > 1 ||
      !Number.isFinite(claimedAt) ||
      (redeemedAt !== null && !Number.isFinite(redeemedAt)) ||
      (ticket.status === "ACTIVE" && ticket.redeemedAt !== null) ||
      (ticket.status === "REDEEMED" && ticket.redeemedAt === null)
    ) {
      throw new ApiError("FABRIC_UNAVAILABLE", "链上门票数据格式无效");
    }
  }
}
