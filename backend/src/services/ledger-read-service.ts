import { ApiError } from "../errors/api-error.js";
import type { Ticket } from "../types/domain.js";

export interface TicketCounts {
  issuedCount: number;
  redeemedCount: number;
}

export interface LedgerReadService {
  getTicketCounts(eventId: string): Promise<TicketCounts>;
  findTicketByOwnerForEvent(ownerId: string, eventId: string): Promise<Ticket | null>;
}

export class UnavailableLedgerReadService implements LedgerReadService {
  private unavailable(): never {
    throw new ApiError("FABRIC_UNAVAILABLE", "Fabric Gateway 暂不可用");
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
