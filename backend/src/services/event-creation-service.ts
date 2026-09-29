import { createHash, randomUUID } from "node:crypto";

import type { DatabaseConnection } from "../db/client.js";
import type {
  EventRecord,
  EventRepository,
  NewEventRecord,
} from "../db/repositories/event-repository.js";
import type {
  IdempotencyRecord,
  IdempotencyRepository,
} from "../db/repositories/idempotency-repository.js";
import { ApiError } from "../errors/api-error.js";
import {
  parseChaincodeError,
  toApiError,
  type GatewayError,
} from "../fabric/gateway-error.js";
import type {
  ChainEvent,
  ConfirmedSubmit,
  GatewayAdapter,
} from "../fabric/types.js";
import type { Event, Operation } from "../types/domain.js";
import type { DateClock, EventService } from "./event-service.js";

export interface CreateEventInput {
  title: string;
  description: string;
  location: string;
  capacity: number;
  registrationDeadline: string;
  startAt: string;
  endAt: string;
}

export interface CreateEventCommand {
  idempotencyKey: string;
  actorId: string;
  input: CreateEventInput;
}

export interface CreateEventResult {
  event: Event;
  replayed: boolean;
  txId: string;
}

export interface PreparedCreateEvent {
  input: CreateEventInput;
  requestHash: string;
}

interface Reservation {
  record: IdempotencyRecord;
  created: boolean;
}

interface Completion {
  event: Event;
  txId: string;
}

type EventIdFactory = () => string;

const systemClock: DateClock = () => new Date();

export const prepareCreateEvent = (
  input: CreateEventInput,
): PreparedCreateEvent => {
  const normalized: CreateEventInput = {
    title: input.title.trim(),
    description: input.description,
    location: input.location.trim(),
    capacity: input.capacity,
    registrationDeadline: new Date(input.registrationDeadline).toISOString(),
    startAt: new Date(input.startAt).toISOString(),
    endAt: new Date(input.endAt).toISOString(),
  };
  const requestHash = createHash("sha256")
    .update(JSON.stringify(normalized))
    .digest("hex");

  return { input: normalized, requestHash };
};

export class EventCreationService {
  private readonly inFlight = new Map<string, Promise<Completion>>();

  constructor(
    private readonly database: DatabaseConnection,
    private readonly events: EventRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly gateway: GatewayAdapter,
    private readonly eventQueries: EventService,
    private readonly clock: DateClock = systemClock,
    private readonly eventIdFactory: EventIdFactory = randomUUID,
  ) {}

  async create(command: CreateEventCommand): Promise<CreateEventResult> {
    const prepared = prepareCreateEvent(command.input);
    const reservation = this.reserve(command, prepared);

    if (reservation.record.state === "CONFIRMED") {
      const completion = await this.loadConfirmed(reservation.record, prepared.input);
      return { ...completion, replayed: true };
    }

    const active = this.inFlight.get(command.idempotencyKey);
    if (active) {
      const completion = await active;
      return { ...completion, replayed: true };
    }

    const task = reservation.created
      ? this.submit(reservation.record, prepared.input, true)
      : this.reconcile(reservation.record, prepared.input, true);
    this.inFlight.set(command.idempotencyKey, task);

    try {
      const completion = await task;
      return { ...completion, replayed: !reservation.created };
    } finally {
      if (this.inFlight.get(command.idempotencyKey) === task) {
        this.inFlight.delete(command.idempotencyKey);
      }
    }
  }

  private reserve(
    command: CreateEventCommand,
    prepared: PreparedCreateEvent,
  ): Reservation {
    const operation = this.database.transaction((): Reservation => {
      const existing = this.idempotency.findByKey(command.idempotencyKey);
      if (existing) {
        if (
          existing.actorId !== command.actorId ||
          existing.requestHash !== prepared.requestHash
        ) {
          throw new ApiError(
            "IDEMPOTENCY_CONFLICT",
            "Idempotency-Key 已绑定其他创建请求",
          );
        }
        return { record: existing, created: false };
      }

      const now = this.clock();
      if (now.getTime() >= Date.parse(prepared.input.registrationDeadline)) {
        throw new ApiError(
          "REGISTRATION_CLOSED",
          "报名截止时间必须晚于当前时间",
        );
      }
      const timestamp = now.toISOString();
      const record: IdempotencyRecord = {
        key: command.idempotencyKey,
        actorId: command.actorId,
        requestHash: prepared.requestHash,
        eventId: this.eventIdFactory(),
        state: "PENDING",
        txId: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.idempotency.insert(record);
      return { record, created: true };
    });

    return operation.immediate();
  }

  private async submit(
    record: IdempotencyRecord,
    input: CreateEventInput,
    allowRetryAfterNotFound: boolean,
  ): Promise<Completion> {
    let confirmed: ConfirmedSubmit<ChainEvent>;
    try {
      confirmed = await this.gateway.submitAndConfirm<ChainEvent>(
        "CreateEvent",
        this.chainArgs(record, input),
      );
    } catch (error) {
      return this.handleSubmitFailure(
        record,
        input,
        allowRetryAfterNotFound,
        error,
      );
    }

    this.assertChainMatches(record, input, confirmed.result);
    return this.finalize(record, input, confirmed.txId);
  }

  private async handleSubmitFailure(
    record: IdempotencyRecord,
    input: CreateEventInput,
    allowRetryAfterNotFound: boolean,
    error: unknown,
  ): Promise<Completion> {
    const gatewayError = parseChaincodeError(error);
    if (gatewayError.txId) {
      this.idempotency.rememberPendingTx(
        record.key,
        gatewayError.txId,
        this.clock().toISOString(),
      );
      record.txId = gatewayError.txId;
    }

    if (
      gatewayError.kind === "BUSINESS" &&
      gatewayError.businessCode !== "IDEMPOTENCY_CONFLICT"
    ) {
      this.idempotency.markFailed(record.key, this.clock().toISOString());
      throw toApiError(gatewayError);
    }

    return this.reconcile(
      record,
      input,
      allowRetryAfterNotFound &&
        gatewayError.businessCode !== "IDEMPOTENCY_CONFLICT",
      gatewayError,
    );
  }

  private async reconcile(
    record: IdempotencyRecord,
    input: CreateEventInput,
    allowRetryAfterNotFound: boolean,
    originalError?: GatewayError,
  ): Promise<Completion> {
    const chainEvent = await this.findChainEvent(record.eventId);
    if (!chainEvent) {
      if (allowRetryAfterNotFound) {
        return this.submit(record, input, false);
      }
      if (originalError) throw toApiError(originalError);
      throw new ApiError(
        "FABRIC_UNAVAILABLE",
        "无法确认活动创建交易状态",
      );
    }

    this.assertChainMatches(record, input, chainEvent);
    const txId = record.txId ?? (await this.findCreateOperationTxId(record.eventId));
    return this.finalize(record, input, txId);
  }

  private async findChainEvent(eventId: string): Promise<ChainEvent | null> {
    try {
      return await this.gateway.evaluate<ChainEvent>("GetEvent", [eventId]);
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

  private async findCreateOperationTxId(eventId: string): Promise<string> {
    try {
      const operations = await this.gateway.evaluate<Operation[]>(
        "GetOperationsByEvent",
        [eventId],
      );
      const operation = operations.find(({ type }) => type === "EVENT_CREATED");
      if (operation) return operation.txId;
    } catch (error) {
      throw toApiError(error);
    }

    throw new ApiError(
      "FABRIC_UNAVAILABLE",
      "链上活动存在但创建交易记录不可用",
    );
  }

  private finalize(
    record: IdempotencyRecord,
    input: CreateEventInput,
    txId: string,
  ): Completion {
    const operation = this.database.transaction(() => {
      const existing = this.events.findById(
        record.eventId,
        this.clock().toISOString(),
      );
      if (existing) {
        this.assertLocalMatches(record, input, existing);
      } else {
        const newEvent: NewEventRecord = {
          id: record.eventId,
          organizerId: record.actorId,
          title: input.title,
          description: input.description,
          location: input.location,
          capacity: input.capacity,
          registrationDeadline: input.registrationDeadline,
          startAt: input.startAt,
          endAt: input.endAt,
          createdAt: record.createdAt,
        };
        this.events.insert(newEvent);
      }
      this.idempotency.markConfirmed(
        record.key,
        txId,
        this.clock().toISOString(),
      );
    });

    try {
      operation.immediate();
    } catch (error) {
      if (error instanceof ApiError) {
        this.idempotency.markFailed(record.key, this.clock().toISOString());
      }
      throw error;
    }

    const stored = this.eventQueries.findRecord(record.eventId);
    return { event: this.toCreatedEvent(stored), txId };
  }

  private async loadConfirmed(
    record: IdempotencyRecord,
    input: CreateEventInput,
  ): Promise<Completion> {
    const stored = this.events.findById(record.eventId, this.clock().toISOString());
    if (!stored || !record.txId) {
      throw new ApiError(
        "FABRIC_UNAVAILABLE",
        "本地活动与幂等记录不一致",
      );
    }
    this.assertLocalMatches(record, input, stored);
    return {
      event: await this.eventQueries.toEvent(stored),
      txId: record.txId,
    };
  }

  private assertChainMatches(
    record: IdempotencyRecord,
    input: CreateEventInput,
    chainEvent: ChainEvent,
  ): void {
    if (
      chainEvent.eventId !== record.eventId ||
      chainEvent.organizerId !== record.actorId ||
      chainEvent.capacity !== input.capacity ||
      chainEvent.startAt !== input.startAt ||
      chainEvent.endAt !== input.endAt
    ) {
      this.idempotency.markFailed(record.key, this.clock().toISOString());
      throw new ApiError(
        "IDEMPOTENCY_CONFLICT",
        "链上活动与幂等创建请求不一致",
      );
    }
  }

  private assertLocalMatches(
    record: IdempotencyRecord,
    input: CreateEventInput,
    event: EventRecord,
  ): void {
    if (
      event.id !== record.eventId ||
      event.organizerId !== record.actorId ||
      event.title !== input.title ||
      event.description !== input.description ||
      event.location !== input.location ||
      event.capacity !== input.capacity ||
      event.registrationDeadline !== input.registrationDeadline ||
      event.startAt !== input.startAt ||
      event.endAt !== input.endAt
    ) {
      throw new ApiError(
        "IDEMPOTENCY_CONFLICT",
        "本地活动与幂等创建请求不一致",
      );
    }
  }

  private chainArgs(
    record: IdempotencyRecord,
    input: CreateEventInput,
  ): readonly string[] {
    return [
      record.eventId,
      record.actorId,
      String(input.capacity),
      input.startAt,
      input.endAt,
    ];
  }

  private toCreatedEvent(record: EventRecord): Event {
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
      winnerCount: 0,
      issuedCount: 0,
      redeemedCount: 0,
      createdAt: record.createdAt,
    };
  }
}
