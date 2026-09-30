import { ApiError } from "../errors/api-error.js";
import { toApiError } from "../fabric/gateway-error.js";
import type { EvaluateMethod, GatewayAdapter } from "../fabric/types.js";
import {
  operationTypes,
  type Operation,
  type OperationType,
  type PageResult,
  type User,
} from "../types/domain.js";
import type { EventService } from "./event-service.js";
import type { TicketService } from "./ticket-service.js";

export interface OperationPageInput {
  page: number;
  pageSize: number;
  type?: OperationType | undefined;
}

const ticketOperationTypes = new Set<OperationType>([
  "TICKET_CLAIMED",
  "TICKET_TRANSFERRED",
  "TICKET_REDEEMED",
]);

export class OperationService {
  constructor(
    private readonly gateway: GatewayAdapter,
    private readonly events: EventService,
    private readonly tickets: TicketService,
  ) {}

  async listForEvent(
    eventId: string,
    actorId: string,
    input: OperationPageInput,
  ): Promise<PageResult<Operation>> {
    const event = this.events.findRecord(eventId);
    if (event.organizerId !== actorId) {
      throw new ApiError("FORBIDDEN", "只有活动主办方可以查看操作记录");
    }

    const operations = await this.readOperations("GetOperationsByEvent", eventId);
    const validated = this.validateOperations(operations, (operation) => {
      if (operation.eventId !== eventId) {
        this.inconsistent("活动操作记录包含其他活动的数据");
      }
    });
    const filtered = input.type
      ? validated.filter((operation) => operation.type === input.type)
      : validated;
    return this.paginate(filtered, input.page, input.pageSize);
  }

  async listForTicket(
    ticketId: string,
    actor: User,
    page: number,
    pageSize: number,
  ): Promise<PageResult<Operation>> {
    const ticket = await this.tickets.get(ticketId, actor);
    const operations = await this.readOperations("GetOperationsByTicket", ticketId);
    const validated = this.validateOperations(operations, (operation) => {
      if (
        operation.eventId !== ticket.eventId ||
        operation.ticketId !== ticketId ||
        !ticketOperationTypes.has(operation.type)
      ) {
        this.inconsistent("门票操作记录与请求的门票不一致");
      }
    });
    return this.paginate(validated, page, pageSize);
  }

  private async readOperations(
    method: EvaluateMethod,
    resourceId: string,
  ): Promise<unknown[]> {
    try {
      const result = await this.gateway.evaluate<unknown>(method, [resourceId]);
      if (!Array.isArray(result)) {
        this.inconsistent("链上操作记录不是数组");
      }
      return result;
    } catch (error) {
      const mapped = toApiError(error);
      if (mapped.code === "NOT_FOUND") {
        throw new ApiError(
          "FABRIC_UNAVAILABLE",
          "链上资源与本地记录不一致",
          { cause: error },
        );
      }
      throw mapped;
    }
  }

  private validateOperations(
    values: readonly unknown[],
    assertScope: (operation: Operation) => void,
  ): Operation[] {
    const seen = new Set<string>();
    const operations = values.map((value) => {
      this.assertOperationShape(value);
      assertScope(value);
      if (seen.has(value.txId)) {
        this.inconsistent("链上操作记录包含重复交易");
      }
      seen.add(value.txId);
      return value;
    });

    return operations.sort(
      (left, right) =>
        right.occurredAt.localeCompare(left.occurredAt) ||
        right.txId.localeCompare(left.txId),
    );
  }

  private paginate(
    operations: readonly Operation[],
    page: number,
    pageSize: number,
  ): PageResult<Operation> {
    const start = (page - 1) * pageSize;
    return {
      data: operations.slice(start, start + pageSize),
      page,
      pageSize,
      total: operations.length,
    };
  }

  private assertOperationShape(value: unknown): asserts value is Operation {
    if (!value || typeof value !== "object") {
      this.inconsistent("链上操作记录格式无效");
    }
    const operation = value as Partial<Operation>;
    const validType = operationTypes.includes(operation.type as OperationType);
    const validBlockNumber =
      operation.blockNumber === null ||
      (typeof operation.blockNumber === "number" &&
        Number.isInteger(operation.blockNumber) &&
        operation.blockNumber >= 0);
    const validNullableUserId = (userId: unknown): boolean =>
      userId === null || (typeof userId === "string" && userId.length > 0);

    if (
      typeof operation.id !== "string" ||
      operation.id.length === 0 ||
      operation.id !== operation.txId ||
      typeof operation.eventId !== "string" ||
      operation.eventId.length === 0 ||
      !validType ||
      typeof operation.actorId !== "string" ||
      operation.actorId.length === 0 ||
      !validNullableUserId(operation.fromUserId) ||
      !validNullableUserId(operation.toUserId) ||
      typeof operation.occurredAt !== "string" ||
      !Number.isFinite(Date.parse(operation.occurredAt)) ||
      typeof operation.txId !== "string" ||
      operation.txId.length === 0 ||
      typeof operation.channelName !== "string" ||
      operation.channelName.length === 0 ||
      typeof operation.chaincodeName !== "string" ||
      operation.chaincodeName.length === 0 ||
      !validBlockNumber
    ) {
      this.inconsistent("链上操作记录格式无效");
    }

    if (
      operation.type === "EVENT_CREATED" ||
      operation.type === "DRAW_PUBLISHED"
    ) {
      if (operation.ticketId !== null) {
        this.inconsistent("活动操作记录不应关联门票");
      }
      return;
    }

    if (
      typeof operation.ticketId !== "string" ||
      !/^[0-9a-f]{64}$/.test(operation.ticketId)
    ) {
      this.inconsistent("票务操作记录缺少合法门票标识");
    }
  }

  private inconsistent(message: string): never {
    throw new ApiError("FABRIC_UNAVAILABLE", message);
  }
}
