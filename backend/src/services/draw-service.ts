import { createHash, randomInt } from "node:crypto";

import type { DatabaseConnection } from "../db/client.js";
import type {
  DrawAttemptRecord,
  DrawRepository,
} from "../db/repositories/draw-repository.js";
import type {
  EventRecord,
  EventRepository,
} from "../db/repositories/event-repository.js";
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
import type { EventStatus, Operation, User } from "../types/domain.js";
import type { DateClock } from "./event-service.js";

export interface PublishDrawResult {
  eventId: string;
  winnerCount: number;
  winnersHash: string;
  txId: string;
}

export interface DrawStatusResult {
  status: EventStatus;
  registrationCount: number;
  winnerCount: number;
  winnersHash: string | null;
  winners: User[];
}

interface DrawReservation {
  attempt: DrawAttemptRecord;
  created: boolean;
}

export type SecureRandomIndex = (upperExclusive: number) => number;

const systemClock: DateClock = () => new Date();
const cryptoRandomIndex: SecureRandomIndex = (upperExclusive) =>
  randomInt(upperExclusive);

export const selectWinners = (
  userIds: readonly string[],
  capacity: number,
  randomIndex: SecureRandomIndex = cryptoRandomIndex,
): string[] => {
  const shuffled = [...userIds];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const selected = randomIndex(index + 1);
    if (!Number.isInteger(selected) || selected < 0 || selected > index) {
      throw new Error("Secure random index is outside the requested range");
    }
    [shuffled[index], shuffled[selected]] = [
      shuffled[selected]!,
      shuffled[index]!,
    ];
  }
  return shuffled
    .slice(0, Math.min(capacity, shuffled.length))
    .sort((left, right) => left.localeCompare(right));
};

const hashWinnerIds = (winnerIdsJson: string): string =>
  createHash("sha256").update(winnerIdsJson, "utf8").digest("hex");

export class DrawService {
  private readonly inFlight = new Map<string, Promise<PublishDrawResult>>();

  constructor(
    private readonly database: DatabaseConnection,
    private readonly events: EventRepository,
    private readonly draws: DrawRepository,
    private readonly gateway: GatewayAdapter,
    private readonly clock: DateClock = systemClock,
    private readonly randomIndex: SecureRandomIndex = cryptoRandomIndex,
  ) {}

  async publish(eventId: string, actorId: string): Promise<PublishDrawResult> {
    const visible = this.requireOwnedEvent(eventId, actorId);
    if (visible.storedStatus === "DRAWN") {
      throw new ApiError("ALREADY_DRAWN", "活动已经完成抽签");
    }
    if (this.inFlight.has(eventId)) {
      throw new ApiError("DRAW_IN_PROGRESS", "抽签正在处理中");
    }

    const reservation = this.reserve(eventId, actorId);
    const task = reservation.created
      ? this.submit(reservation.attempt, true)
      : this.reconcile(reservation.attempt, true);
    this.inFlight.set(eventId, task);

    try {
      return await task;
    } finally {
      if (this.inFlight.get(eventId) === task) this.inFlight.delete(eventId);
    }
  }

  getStatus(eventId: string, actorId: string): DrawStatusResult {
    const event = this.requireOwnedEvent(eventId, actorId);
    if (event.storedStatus !== "DRAWN" && event.storedStatus !== "FINISHED") {
      return {
        status: event.status,
        registrationCount: event.registrationCount,
        winnerCount: 0,
        winnersHash: null,
        winners: [],
      };
    }

    const attempt = this.draws.findAttempt(eventId);
    const winners = this.draws.listConfirmedWinners(eventId);
    if (
      !attempt ||
      attempt.state !== "CONFIRMED" ||
      !attempt.txId ||
      event.drawWinnersHash !== attempt.winnersHash ||
      winners.length !== event.winnerCount
    ) {
      throw new ApiError(
        "FABRIC_UNAVAILABLE",
        "本地抽签确认状态不一致",
      );
    }

    return {
      status: event.status,
      registrationCount: event.registrationCount,
      winnerCount: winners.length,
      winnersHash: attempt.winnersHash,
      winners,
    };
  }

  private reserve(eventId: string, actorId: string): DrawReservation {
    const operation = this.database.transaction((): DrawReservation => {
      const event = this.requireOwnedEvent(eventId, actorId);
      if (event.storedStatus === "DRAWN") {
        throw new ApiError("ALREADY_DRAWN", "活动已经完成抽签");
      }
      if (event.storedStatus === "DRAWING") {
        const existing = this.draws.findAttempt(eventId);
        if (!existing) return this.inconsistent("抽签中活动缺少持久化尝试");
        if (existing.state === "CONFLICT") {
          throw new ApiError("FABRIC_UNAVAILABLE", "抽签状态存在冲突，无法继续");
        }
        return { attempt: existing, created: false };
      }
      if (event.storedStatus !== "OPEN") {
        throw new ApiError("DRAW_NOT_READY", "当前不能抽签");
      }

      const now = this.clock();
      if (
        now.getTime() < Date.parse(event.registrationDeadline) ||
        now.getTime() >= Date.parse(event.startAt)
      ) {
        throw new ApiError("DRAW_NOT_READY", "当前不在抽签时间窗口内");
      }
      if (this.draws.findAttempt(eventId)) {
        return this.inconsistent("开放活动已存在抽签尝试");
      }

      const winnerIds = selectWinners(
        this.draws.listRegistrationUserIds(eventId),
        event.capacity,
        this.randomIndex,
      );
      const winnerIdsJson = JSON.stringify(winnerIds);
      const timestamp = now.toISOString();
      const attempt: DrawAttemptRecord = {
        eventId,
        winnerIdsJson,
        winnersHash: hashWinnerIds(winnerIdsJson),
        state: "PENDING",
        txId: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.draws.insertAttempt(attempt);
      if (!this.draws.setEventDrawing(eventId)) {
        return this.inconsistent("活动未能原子进入抽签状态");
      }
      return { attempt, created: true };
    });

    return operation.immediate();
  }

  private async submit(
    attempt: DrawAttemptRecord,
    allowRetryAfterUnpublished: boolean,
  ): Promise<PublishDrawResult> {
    let confirmed: ConfirmedSubmit<ChainEvent>;
    try {
      confirmed = await this.gateway.submitAndConfirm<ChainEvent>(
        "PublishDraw",
        [attempt.eventId, attempt.winnerIdsJson, attempt.winnersHash],
      );
    } catch (error) {
      return this.handleSubmitFailure(
        attempt,
        allowRetryAfterUnpublished,
        error,
      );
    }

    const winnerIds = this.parseWinnerIds(attempt);
    this.assertPublishedChainMatches(attempt, winnerIds, confirmed.result);
    return this.finalize(attempt, winnerIds, confirmed.txId);
  }

  private async handleSubmitFailure(
    attempt: DrawAttemptRecord,
    allowRetryAfterUnpublished: boolean,
    error: unknown,
  ): Promise<PublishDrawResult> {
    const gatewayError = parseChaincodeError(error);
    if (gatewayError.txId) {
      this.draws.rememberPendingTx(
        attempt.eventId,
        gatewayError.txId,
        this.clock().toISOString(),
      );
      attempt.txId = gatewayError.txId;
    }

    if (
      gatewayError.kind === "BUSINESS" &&
      gatewayError.businessCode !== "ALREADY_DRAWN"
    ) {
      throw toApiError(gatewayError);
    }

    return this.reconcile(
      attempt,
      allowRetryAfterUnpublished && gatewayError.businessCode !== "ALREADY_DRAWN",
      gatewayError,
    );
  }

  private async reconcile(
    attempt: DrawAttemptRecord,
    allowRetryAfterUnpublished: boolean,
    originalError?: GatewayError,
  ): Promise<PublishDrawResult> {
    const winnerIds = this.parseWinnerIds(attempt);
    let chainEvent: ChainEvent;
    try {
      chainEvent = await this.gateway.evaluate<ChainEvent>("GetEvent", [
        attempt.eventId,
      ]);
    } catch (error) {
      const mapped = toApiError(error);
      if (mapped.code === "NOT_FOUND") {
        return this.conflict(attempt.eventId, "链上活动不存在");
      }
      throw mapped;
    }

    this.assertChainEventIdentity(attempt.eventId, chainEvent);
    if (chainEvent.drawPublished) {
      this.assertPublishedChainMatches(attempt, winnerIds, chainEvent);
      const txId = attempt.txId ?? (await this.findPublishOperationTxId(attempt.eventId));
      return this.finalize(attempt, winnerIds, txId);
    }

    if (originalError?.businessCode === "ALREADY_DRAWN") {
      return this.conflict(
        attempt.eventId,
        "链码报告已抽签但链上读取未确认发布",
      );
    }
    if (allowRetryAfterUnpublished) return this.submit(attempt, false);
    if (originalError) throw toApiError(originalError);
    throw new ApiError("FABRIC_UNAVAILABLE", "无法确认抽签发布交易状态");
  }

  private finalize(
    attempt: DrawAttemptRecord,
    winnerIds: readonly string[],
    txId: string,
  ): PublishDrawResult {
    const operation = this.database.transaction(() => {
      const current = this.draws.findAttempt(attempt.eventId);
      if (
        !current ||
        current.state === "CONFLICT" ||
        current.winnerIdsJson !== attempt.winnerIdsJson ||
        current.winnersHash !== attempt.winnersHash
      ) {
        return this.inconsistent("持久化抽签名单已发生变化");
      }
      this.draws.complete(
        attempt.eventId,
        winnerIds,
        attempt.winnersHash,
        txId,
        this.clock().toISOString(),
      );
    });
    operation.immediate();

    return {
      eventId: attempt.eventId,
      winnerCount: winnerIds.length,
      winnersHash: attempt.winnersHash,
      txId,
    };
  }

  private parseWinnerIds(attempt: DrawAttemptRecord): string[] {
    try {
      const parsed: unknown = JSON.parse(attempt.winnerIdsJson);
      if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string")) {
        return this.conflict(attempt.eventId, "持久化抽签名单格式无效");
      }
      const winnerIds = parsed as string[];
      const canonical = [...new Set(winnerIds)].sort((left, right) =>
        left.localeCompare(right),
      );
      if (
        JSON.stringify(canonical) !== attempt.winnerIdsJson ||
        hashWinnerIds(attempt.winnerIdsJson) !== attempt.winnersHash
      ) {
        return this.conflict(attempt.eventId, "持久化抽签名单或哈希无效");
      }
      return winnerIds;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      return this.conflict(attempt.eventId, "持久化抽签名单无法解析");
    }
  }

  private assertChainEventIdentity(eventId: string, chainEvent: ChainEvent): void {
    const local = this.events.findById(eventId, this.clock().toISOString());
    if (
      !local ||
      chainEvent.eventId !== local.id ||
      chainEvent.organizerId !== local.organizerId ||
      chainEvent.capacity !== local.capacity ||
      chainEvent.startAt !== local.startAt ||
      chainEvent.endAt !== local.endAt
    ) {
      this.conflict(eventId, "链上活动与本地活动不一致");
    }
  }

  private assertPublishedChainMatches(
    attempt: DrawAttemptRecord,
    winnerIds: readonly string[],
    chainEvent: ChainEvent,
  ): void {
    this.assertChainEventIdentity(attempt.eventId, chainEvent);
    if (
      !chainEvent.drawPublished ||
      chainEvent.winnersHash !== attempt.winnersHash ||
      chainEvent.winnerCount !== winnerIds.length
    ) {
      this.conflict(attempt.eventId, "链上抽签结果与持久化名单不一致");
    }
  }

  private async findPublishOperationTxId(eventId: string): Promise<string> {
    try {
      const operations = await this.gateway.evaluate<Operation[]>(
        "GetOperationsByEvent",
        [eventId],
      );
      const operation = operations.find(({ type }) => type === "DRAW_PUBLISHED");
      if (operation) return operation.txId;
    } catch (error) {
      throw toApiError(error);
    }
    throw new ApiError("FABRIC_UNAVAILABLE", "链上抽签已发布但交易记录不可用");
  }

  private requireOwnedEvent(eventId: string, actorId: string): EventRecord {
    const event = this.events.findById(eventId, this.clock().toISOString());
    if (!event) throw new ApiError("NOT_FOUND", "活动不存在");
    if (event.organizerId !== actorId) {
      throw new ApiError("FORBIDDEN", "只能管理本人创建的活动");
    }
    return event;
  }

  private conflict(eventId: string, message: string): never {
    this.draws.markConflict(eventId, this.clock().toISOString());
    throw new ApiError("FABRIC_UNAVAILABLE", message);
  }

  private inconsistent(message: string): never {
    throw new ApiError("FABRIC_UNAVAILABLE", message);
  }
}
