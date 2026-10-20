import { createHash } from "node:crypto";
import { ApiError } from "../errors/api-error.js";
import { toApiError } from "../fabric/gateway-error.js";
import type { ChainEvent, GatewayAdapter } from "../fabric/types.js";
import type { Ticket } from "../types/domain.js";

export interface TicketCounts {
  issuedCount: number;
  redeemedCount: number;
}

export interface LedgerReadService {
  getTicketCounts(eventId: string): Promise<TicketCounts>;
  hasClaimedTicket(eventId: string, winnerId: string): Promise<boolean>;
  findTicketByOwnerForEvent(
    ownerId: string,
    eventId: string,
  ): Promise<Ticket | null>;
}

export class GatewayLedgerReadService implements LedgerReadService {
  constructor(private readonly gateway: GatewayAdapter) {}

  async hasClaimedTicket(eventId: string, winnerId: string): Promise<boolean> {
    const ticketId = createHash("sha256")
      .update(`ticket:${eventId}:${winnerId}`, "utf8")
      .digest("hex");
    try {
      const ticket = await this.gateway.evaluate<Ticket>("GetTicket", [
        ticketId,
      ]);
      if (
        ticket.id !== ticketId ||
        ticket.eventId !== eventId ||
        ticket.originalWinnerId !== winnerId
      ) {
        throw new ApiError("FABRIC_UNAVAILABLE", "链上领取记录与请求不一致");
      }
      return true;
    } catch (error) {
      const mapped = toApiError(error);
      if (mapped.code === "NOT_FOUND") return false;
      throw mapped;
    }
  }

  async getTicketCounts(eventId: string): Promise<TicketCounts> {
    try {
      const event = await this.gateway.evaluate<ChainEvent>("GetEvent", [
        eventId,
      ]);
      return {
        issuedCount: event.issuedCount,
        redeemedCount: event.redeemedCount,
      };
    } catch (error) {
      const mapped = toApiError(error);
      if (mapped.code === "NOT_FOUND") {
        throw new ApiError(
          "FABRIC_UNAVAILABLE",
          "链上活动状态与本地记录不一致",
          { cause: error },
        );
      }
      throw mapped;
    }
  }

  async findTicketByOwnerForEvent(
    ownerId: string,
    eventId: string,
  ): Promise<Ticket | null> {
    try {
      const tickets = await this.gateway.evaluate<Ticket[]>(
        "GetTicketsByOwner",
        [ownerId],
      );
      return tickets.find((ticket) => ticket.eventId === eventId) ?? null;
    } catch (error) {
      throw toApiError(error);
    }
  }
}

export class UnavailableLedgerReadService implements LedgerReadService {
  private unavailable(): never {
    throw new ApiError("FABRIC_UNAVAILABLE", "Fabric Gateway 暂不可用");
  }

  async hasClaimedTicket(
    _eventId: string,
    _winnerId: string,
  ): Promise<boolean> {
    return this.unavailable();
  }

  async getTicketCounts(_eventId: string): Promise<TicketCounts> {
    return this.unavailable();
  }

  async findTicketByOwnerForEvent(
    _ownerId: string,
    _eventId: string,
  ): Promise<Ticket | null> {
    return this.unavailable();
  }
}
