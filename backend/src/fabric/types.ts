import type { Operation, Ticket } from "../types/domain.js";

export const evaluateMethods = [
  "GetEvent",
  "GetTicket",
  "GetTicketsByOwner",
  "GetOperationsByEvent",
  "GetOperationsByTicket",
] as const;
export type EvaluateMethod = (typeof evaluateMethods)[number];

export const submitMethods = [
  "CreateEvent",
  "PublishDraw",
  "ClaimTicket",
  "TransferTicket",
  "RedeemTicket",
] as const;
export type SubmitMethod = (typeof submitMethods)[number];

export type GatewayMode = "mock" | "fabric";

export interface ChainEvent {
  eventId: string;
  organizerId: string;
  capacity: number;
  startAt: string;
  endAt: string;
  drawPublished: boolean;
  winnersHash: string | null;
  winnerCount: number;
  issuedCount: number;
  redeemedCount: number;
}

export interface ConfirmedSubmit<T> {
  result: T;
  txId: string;
  commitStatus: "VALID";
  blockNumber: number | null;
  gatewayMode: GatewayMode;
  operation: Operation | null;
}

export interface GatewayAdapter {
  readonly mode: GatewayMode;

  evaluate<T>(method: EvaluateMethod, args: readonly string[]): Promise<T>;
  submitAndConfirm<T>(
    method: SubmitMethod,
    args: readonly string[],
  ): Promise<ConfirmedSubmit<T>>;
}

export interface MockLedgerSnapshot {
  events: ChainEvent[];
  tickets: Ticket[];
  operations: Operation[];
}
