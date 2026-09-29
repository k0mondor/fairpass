export const roles = ["STUDENT", "ORGANIZER", "INSPECTOR"] as const;
export type Role = (typeof roles)[number];

export const eventStatuses = ["OPEN", "DRAWING", "DRAWN", "FINISHED"] as const;
export type EventStatus = (typeof eventStatuses)[number];

export const registrationStatuses = ["REGISTERED", "WON", "LOST"] as const;
export type RegistrationStatus = (typeof registrationStatuses)[number];

export const ticketStatuses = ["ACTIVE", "REDEEMED"] as const;
export type TicketStatus = (typeof ticketStatuses)[number];

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

export interface Event {
  id: string;
  organizerId: string;
  title: string;
  description: string;
  location: string;
  capacity: number;
  registrationDeadline: string;
  startAt: string;
  endAt: string;
  status: EventStatus;
  registrationCount: number;
  winnerCount: number;
  issuedCount: number;
  redeemedCount: number;
  createdAt: string;
}

export interface Registration {
  id: string;
  eventId: string;
  userId: string;
  status: RegistrationStatus;
  createdAt: string;
}

export interface RegistrationWithEvent extends Registration {
  event: Event;
}

export interface Ticket {
  id: string;
  eventId: string;
  originalWinnerId: string;
  ownerId: string;
  status: TicketStatus;
  transferCount: number;
  claimedAt: string;
  redeemedAt: string | null;
}

export interface EventDetail extends Event {
  myRegistration: Registration | null;
  myTicket: Ticket | null;
}

export interface PageResult<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}
