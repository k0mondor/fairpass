import { ApiError } from "../errors/api-error.js";
import {
  EventRepository,
  type EventListInput,
  type EventRecord,
} from "../db/repositories/event-repository.js";
import type { RegistrationRepository } from "../db/repositories/registration-repository.js";
import type {
  Event,
  EventDetail,
  EventStatus,
  PageResult,
  User,
} from "../types/domain.js";
import type { LedgerReadService } from "./ledger-read-service.js";

export interface EventPageInput {
  page: number;
  pageSize: number;
  status?: EventStatus | undefined;
}

export type DateClock = () => Date;
const systemClock: DateClock = () => new Date();

export class EventService {
  constructor(
    private readonly events: EventRepository,
    private readonly registrations: RegistrationRepository,
    private readonly ledger: LedgerReadService,
    private readonly clock: DateClock = systemClock,
  ) {}

  async list(input: EventPageInput): Promise<PageResult<Event>> {
    return this.listRecords(input);
  }

  async listForOrganizer(
    organizerId: string,
    input: EventPageInput,
  ): Promise<PageResult<Event>> {
    return this.listRecords(input, organizerId);
  }

  async getDetail(eventId: string, actor: User): Promise<EventDetail> {
    const record = this.findRecord(eventId);
    const event = await this.toEvent(record);

    if (actor.role !== "STUDENT") {
      return { ...event, myRegistration: null, myTicket: null };
    }

    const myRegistration = this.registrations.findByEventAndUser(eventId, actor.id);
    const myTicket = record.drawWinnersHash
      ? await this.ledger.findTicketByOwnerForEvent(actor.id, eventId)
      : null;

    return { ...event, myRegistration, myTicket };
  }

  findRecord(eventId: string, now: Date = this.clock()): EventRecord {
    const record = this.events.findById(eventId, now.toISOString());
    if (!record) throw new ApiError("NOT_FOUND", "活动不存在");
    return record;
  }

  async toEvent(record: EventRecord): Promise<Event> {
    const ticketCounts = record.drawWinnersHash
      ? await this.ledger.getTicketCounts(record.id)
      : { issuedCount: 0, redeemedCount: 0 };
    const drawPublished = record.drawWinnersHash !== null;

    return {
      id: record.id,
      organizerId: record.organizerId,
      title: record.title,
      description: record.description,
      location: record.location,
      capacity: record.capacity,
      registrationDeadline: record.registrationDeadline,
      startAt: record.startAt,
      endAt: record.endAt,
      status: record.status,
      registrationCount: record.registrationCount,
      winnerCount: drawPublished ? record.winnerCount : 0,
      issuedCount: ticketCounts.issuedCount,
      redeemedCount: ticketCounts.redeemedCount,
      createdAt: record.createdAt,
    };
  }

  private async listRecords(
    input: EventPageInput,
    organizerId?: string,
  ): Promise<PageResult<Event>> {
    const repositoryInput: EventListInput = {
      page: input.page,
      pageSize: input.pageSize,
      nowIso: this.clock().toISOString(),
    };
    if (input.status) repositoryInput.status = input.status;
    if (organizerId) repositoryInput.organizerId = organizerId;

    const result = this.events.list(repositoryInput);
    return {
      data: await Promise.all(result.data.map((record) => this.toEvent(record))),
      page: input.page,
      pageSize: input.pageSize,
      total: result.total,
    };
  }
}
