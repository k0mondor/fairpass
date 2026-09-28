export const roles = ["STUDENT", "ORGANIZER", "INSPECTOR"] as const;
export type Role = (typeof roles)[number];

export const eventStatuses = ["OPEN", "DRAWING", "DRAWN", "FINISHED"] as const;
export type EventStatus = (typeof eventStatuses)[number];

export const operationTypes = [
  "EVENT_CREATED",
  "DRAW_PUBLISHED",
  "TICKET_CLAIMED",
  "TICKET_TRANSFERRED",
  "TICKET_REDEEMED",
] as const;
export type OperationType = (typeof operationTypes)[number];

export interface User {
  id: string;
  displayName: string;
  role: Role;
}
